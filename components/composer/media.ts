import type { ComposerMedia } from "./types";

type Row = {
  mediaId: string;
  fileName: string;
  originalName: string;
  mime: string;
  width: number | null;
  height: number | null;
  altText: string;
};

/** DB media row → what the browser needs (no file paths). */
export const rowToMedia = (r: Row): ComposerMedia => ({
  mediaId: r.mediaId,
  src: `/media/${r.fileName}`,
  kind: r.mime.startsWith("video/") ? "video" : "image",
  mime: r.mime,
  width: r.width,
  height: r.height,
  altText: r.altText,
  originalName: r.originalName,
});
