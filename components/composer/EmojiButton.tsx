"use client";

import { useEffect, useRef, useState } from "react";

/** Emoji picker using the `emoji-picker-element` web component. */
export function EmojiButton({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  const pickRef = useRef(onPick);
  useEffect(() => {
    pickRef.current = onPick;
  });

  useEffect(() => {
    if (!open || !holder.current) return;
    const el = holder.current;
    let picker: HTMLElement | null = null;
    import("emoji-picker-element").then(() => {
      picker = document.createElement("emoji-picker");
      picker.addEventListener("emoji-click", (e) => {
        pickRef.current((e as CustomEvent<{ unicode: string }>).detail.unicode);
        setOpen(false);
      });
      el.appendChild(picker);
    });
    return () => picker?.remove();
  }, [open]);

  return (
    <div className="relative">
      <button type="button" className="link-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Emoji
      </button>
      {open && <div ref={holder} className="absolute left-0 top-full z-30 mt-1 border border-line" />}
    </div>
  );
}
