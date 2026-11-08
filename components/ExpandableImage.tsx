"use client";

import { X } from "lucide-react";
import { useRef } from "react";

/** A thumbnail that opens the full image in a modal when clicked. */
export function ExpandableImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        className="block size-full cursor-zoom-in"
        aria-label={alt ? `View full image: ${alt}` : "View full image"}
        onClick={() => dialog.current?.showModal()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className={className} loading="lazy" />
      </button>
      {/* Any click (backdrop, image or button) closes it; Esc works natively. */}
      <dialog
        ref={dialog}
        onClick={() => dialog.current?.close()}
        className="m-auto max-h-none max-w-none cursor-zoom-out bg-transparent p-0 backdrop:bg-black/80 backdrop:backdrop-blur-sm"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className="max-h-[92vh] max-w-[92vw] rounded-xl object-contain" />
        <button type="button" className="icon-btn absolute top-2 right-2 bg-black/60 text-white" aria-label="Close">
          <X className="size-4" />
        </button>
      </dialog>
    </>
  );
}
