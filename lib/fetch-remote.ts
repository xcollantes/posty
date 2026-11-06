import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import path from "node:path";
import { Readable } from "node:stream";

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 5 * 60_000;

// Everything that isn't the public internet, including Tailscale (100.64/10)
// and the Docker network Postgres sits on (172.16/12).
const blocked4 = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
] as const) {
  blocked4.addSubnet(net, bits, "ipv4");
}

// IPv6 is an allowlist: only global unicast, minus the ranges that tunnel to
// or document something else. Mapped and NAT64 addresses fall outside it.
const public6 = new BlockList();
public6.addSubnet("2000::", 3, "ipv6");
const blocked6 = new BlockList();
blocked6.addSubnet("2001::", 23, "ipv6");
blocked6.addSubnet("2001:db8::", 32, "ipv6");
blocked6.addSubnet("2002::", 16, "ipv6");

export function isPublicIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return !blocked4.check(ip, "ipv4");
  return family === 6 && public6.check(ip, "ipv6") && !blocked6.check(ip, "ipv6");
}

type Allow = (ip: string) => boolean;

/**
 * Checks addresses as the socket connects, so a hostname can't pass a check
 * and then rebind to an internal address.
 */
const guardedLookup = (allow: Allow): LookupFunction => (host, options, callback) => {
  dnsLookup(host, { ...options, all: true }, (err, addresses: LookupAddress[]) => {
    if (err) return callback(err, "", 0);
    const refused = addresses.find((a) => !allow(a.address));
    if (refused) return callback(new Error(`Refusing to fetch ${host}: not a public address`), "", 0);
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
};

/** Open a URL that an LLM or web page handed us, without reaching internal hosts. */
function open(url: URL, allow: Allow, signal: AbortSignal): Promise<http.IncomingMessage> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs are supported");
  }
  if (url.username || url.password) throw new Error("URLs with credentials are not supported");
  // Reason: lookup is skipped for IP literals, and new URL() keeps IPv6 brackets.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !allow(host)) throw new Error(`Refusing to fetch ${host}: not a public address`);
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    client
      .get(
        url,
        {
          // Reason: a one-off agent, so no pooled socket or proxy skips the lookup.
          agent: false,
          lookup: guardedLookup(allow),
          signal,
          headers: { "User-Agent": "Mozilla/5.0 (compatible; PostyBot/1.0)", Accept: "*/*" },
        },
        resolve,
      )
      .on("error", reject);
  });
}

/**
 * Stream a remote file. Redirects are followed by hand so every hop goes
 * through the same checks. The caller decides what the bytes are.
 */
export async function fetchRemote(
  rawUrl: string,
  { allow = isPublicIp, timeoutMs = TIMEOUT_MS }: { allow?: Allow; timeoutMs?: number } = {},
): Promise<{ body: ReadableStream<Uint8Array>; name: string }> {
  // Reason: covers the whole download, so a server dripping bytes can't hold it open.
  const signal = AbortSignal.timeout(timeoutMs);
  let url = new URL(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await open(url, allow, signal);
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.destroy();
      url = new URL(res.headers.location, url);
      continue;
    }
    if (status < 200 || status >= 300) {
      res.destroy();
      throw new Error(`Fetching the URL failed with HTTP ${status}`);
    }
    return {
      body: Readable.toWeb(res) as ReadableStream<Uint8Array>,
      name: decodeName(url.pathname),
    };
  }
  throw new Error(`Too many redirects (more than ${MAX_REDIRECTS})`);
}

function decodeName(pathname: string): string {
  const base = path.posix.basename(pathname);
  try {
    return decodeURIComponent(base) || "upload";
  } catch {
    return base || "upload";
  }
}
