import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchUrl } from "@/lib/gcs";
import type { MediaItem } from "@/lib/media";

const upload = vi.fn(async () => {});
const getSignedUrl = vi.fn(async () => ["https://storage.googleapis.com/b/x.jpg?X-Goog-Signature=s"]);
vi.mock("@google-cloud/storage", () => ({
  Storage: class {
    bucket = () => ({ upload, file: () => ({ getSignedUrl }) });
  },
}));

const item = {
  mediaId: "x", kind: "image", mime: "image/jpeg", path: "/data/media/x.ig.jpg",
  url: "https://media.example.com/media/x.ig.jpg", sizeBytes: 1, width: 1, height: 1,
  durationSeconds: null, altText: "",
} satisfies MediaItem;

afterEach(() => {
  delete process.env.GCS_BUCKET;
  vi.clearAllMocks();
});

describe("fetchUrl", () => {
  it("returns the PUBLIC_MEDIA_URL link when GCS_BUCKET is unset", async () => {
    expect(await fetchUrl(item)).toBe(item.url);
    expect(upload).not.toHaveBeenCalled();
  });

  it("uploads to the bucket and returns a signed read URL", async () => {
    process.env.GCS_BUCKET = "b";
    const url = await fetchUrl(item);
    expect(upload).toHaveBeenCalledWith(item.path, {
      destination: "x.ig.jpg",
      metadata: { contentType: "image/jpeg" },
    });
    expect(getSignedUrl).toHaveBeenCalledWith(expect.objectContaining({ version: "v4", action: "read" }));
    expect(url).toContain("X-Goog-Signature");
  });
});
