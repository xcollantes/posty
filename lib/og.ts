/** Minimal OpenGraph fetch for link cards (Bluesky, LinkedIn). */
export type OpenGraph = { url: string; title: string; description: string; image: string | null };

function meta(html: string, prop: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`,
    "i",
  );
  const m = re.exec(html);
  return m ? decode(m[1] ?? m[2]) : null;
}

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

export async function fetchOpenGraph(url: string): Promise<OpenGraph | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PostyBot/1.0)", Accept: "text/html" },
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });
    if (!res.ok || !res.headers.get("content-type")?.includes("html")) return null;
    const html = (await res.text()).slice(0, 500_000);
    const title = meta(html, "og:title") ?? /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? url;
    const description = meta(html, "og:description") ?? meta(html, "description") ?? "";
    const image = meta(html, "og:image");
    return { url, title: decode(title), description, image: image ? new URL(image, res.url).toString() : null };
  } catch {
    return null;
  }
}
