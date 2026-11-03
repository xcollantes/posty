// Client-safe text helpers: Unicode "rich text" styles and counters.

export type TextStyle = "bold" | "italic" | "boldItalic" | "mono";

// Mathematical Alphanumeric Symbols block offsets (sans-serif family, which
// renders cleanly on every network). [upper A, lower a, digit 0 | null]
const STYLE_BASE: Record<TextStyle, [number, number, number | null]> = {
  bold: [0x1d5d4, 0x1d5ee, 0x1d7ec],
  italic: [0x1d608, 0x1d622, null],
  boldItalic: [0x1d63c, 0x1d656, 0x1d7ec],
  mono: [0x1d670, 0x1d68a, 0x1d7f6],
};

const REVERSE = new Map<number, string>();
for (const [upper, lower, digit] of Object.values(STYLE_BASE)) {
  for (let i = 0; i < 26; i++) {
    REVERSE.set(upper + i, String.fromCharCode(65 + i));
    REVERSE.set(lower + i, String.fromCharCode(97 + i));
  }
  if (digit !== null) for (let i = 0; i < 10; i++) REVERSE.set(digit + i, String.fromCharCode(48 + i));
}

/** Map styled characters back to plain ASCII. */
export function toPlain(text: string): string {
  return Array.from(text, (ch) => REVERSE.get(ch.codePointAt(0)!) ?? ch).join("");
}

/** Apply a Unicode style; already-styled text is normalized first so styles don't stack. */
export function applyStyle(text: string, style: TextStyle): string {
  const [upper, lower, digit] = STYLE_BASE[style];
  return Array.from(toPlain(text), (ch) => {
    const c = ch.charCodeAt(0);
    if (c >= 65 && c <= 90) return String.fromCodePoint(upper + c - 65);
    if (c >= 97 && c <= 122) return String.fromCodePoint(lower + c - 97);
    if (digit !== null && c >= 48 && c <= 57) return String.fromCodePoint(digit + c - 48);
    return ch;
  }).join("");
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const encoder = new TextEncoder();

export const graphemes = (text: string) => [...segmenter.segment(text)].length;
export const codePoints = (text: string) => [...text].length;
export const utf8Bytes = (text: string) => encoder.encode(text).length;

const URL_RE = /https?:\/\/[^\s]+/g;

/** Count with every URL weighted as a fixed number of characters (Mastodon: 23). */
export function countWithUrls(text: string, urlWeight: number): number {
  const urls = text.match(URL_RE) ?? [];
  return codePoints(text.replace(URL_RE, "")) + urls.length * urlWeight;
}

/** Threads counts emoji by their UTF-8 byte length. */
export function threadsCount(text: string): number {
  let n = 0;
  for (const { segment } of segmenter.segment(text)) {
    n += /\p{Extended_Pictographic}/u.test(segment) ? utf8Bytes(segment) : 1;
  }
  return n;
}

export const extractUrls = (text: string) => text.match(URL_RE) ?? [];
