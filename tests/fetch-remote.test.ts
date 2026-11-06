import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchRemote, isPublicIp } from "@/lib/fetch-remote";

describe("isPublicIp", () => {
  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "2606:4700:4700::1111",
    "2a00:1450:4001::1",
  ])("allows %s", (ip) => expect(isPublicIp(ip)).toBe(true));

  it.each([
    "0.0.0.0",
    "10.0.0.1",
    "100.100.100.100", // Tailscale
    "127.0.0.1",
    "169.254.169.254", // cloud metadata
    "172.17.0.2", // Docker
    "192.168.1.1",
    "198.18.0.1",
    "224.0.0.1",
    "240.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:8.8.8.8",
    "::7f00:1",
    "fd7a:115c:a1e0::1", // Tailscale
    "fe80::1",
    "64:ff9b::7f00:1", // NAT64
    "2001:db8::1", // documentation
    "2001::1", // Teredo
    "2002:7f00:1::1", // 6to4
    "not-an-ip",
  ])("blocks %s", (ip) => expect(isPublicIp(ip)).toBe(false));
});

describe("fetchRemote", () => {
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/file%20name.png") return void res.end("bytes");
      if (req.url === "/to-file") return void res.writeHead(302, { Location: "/file%20name.png" }).end();
      if (req.url === "/to-ipv6") return void res.writeHead(302, { Location: "http://[::1]/x" }).end();
      if (req.url === "/drip") {
        res.write("first bytes");
        return;
      }
      if (req.url === "/loop") return void res.writeHead(302, { Location: "/loop" }).end();
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  const onlyLoopback = (ip: string) => ip === "127.0.0.1";
  const text = async (body: ReadableStream<Uint8Array>) => new Response(body).text();

  it.each([
    "http://127.0.0.1/",
    "http://2130706433/", // decimal 127.0.0.1
    "http://[::1]/",
    "http://169.254.169.254/latest/meta-data/",
    "http://localhost/", // only caught once DNS resolves it
  ])("refuses %s", async (url) => {
    await expect(fetchRemote(url)).rejects.toThrow(/not a public address/);
  });

  it("refuses other schemes and embedded credentials", async () => {
    await expect(fetchRemote("file:///etc/passwd")).rejects.toThrow(/http and https/);
    await expect(fetchRemote("https://user:pw@example.com/x")).rejects.toThrow(/credentials/);
  });

  it("streams the file and decodes its name", async () => {
    const { body, name } = await fetchRemote(`${base}/file%20name.png`, { allow: onlyLoopback });
    expect(name).toBe("file name.png");
    expect(await text(body)).toBe("bytes");
  });

  it("follows redirects and names the file from the final URL", async () => {
    const { body, name } = await fetchRemote(`${base}/to-file`, { allow: onlyLoopback });
    expect(name).toBe("file name.png");
    expect(await text(body)).toBe("bytes");
  });

  it("checks every redirect hop", async () => {
    await expect(fetchRemote(`${base}/to-ipv6`, { allow: onlyLoopback })).rejects.toThrow(/not a public address/);
  });

  it("times out a server that stalls mid-download", async () => {
    const { body } = await fetchRemote(`${base}/drip`, { allow: onlyLoopback, timeoutMs: 100 });
    await expect(text(body)).rejects.toThrow();
  });

  it("gives up on redirect loops and reports HTTP errors", async () => {
    await expect(fetchRemote(`${base}/loop`, { allow: onlyLoopback })).rejects.toThrow(/Too many redirects/);
    await expect(fetchRemote(`${base}/missing`, { allow: onlyLoopback })).rejects.toThrow(/HTTP 404/);
  });
});
