"use client";

import { rowToMedia } from "./media";
import type { ComposerMedia } from "./types";

/** Read video dimensions/duration in the browser (no ffprobe on the server). */
function videoMeta(file: File): Promise<{ width: number; height: number; duration: number } | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      resolve({ width: video.videoWidth, height: video.videoHeight, duration: video.duration });
      URL.revokeObjectURL(video.src);
    };
    video.onerror = () => resolve(null);
    video.src = URL.createObjectURL(file);
  });
}

/** Upload one file as the raw request body, reporting progress 0..1. */
export async function uploadFile(file: File, onProgress: (p: number) => void): Promise<ComposerMedia> {
  const params = new URLSearchParams({ name: file.name });
  if (file.type.startsWith("video/")) {
    const meta = await videoMeta(file);
    if (meta) {
      params.set("width", String(meta.width));
      params.set("height", String(meta.height));
      params.set("duration", String(meta.duration));
    }
  }
  // Reason: XHR, unlike fetch, reports upload progress (videos can be large).
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/media?${params}`);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      const body = JSON.parse(xhr.responseText || "{}");
      if (xhr.status >= 200 && xhr.status < 300) resolve(rowToMedia(body));
      else reject(new Error(body.error ?? `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.send(file);
  });
}
