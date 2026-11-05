"use client";

import { Copy, Pencil, RotateCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { deletePost, duplicatePost, retryPost } from "@/app/actions/posts";

export function PostActions({ postId, status }: { postId: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const editable = status === "draft" || status === "scheduled" || status === "failed";
  return (
    <div className="flex gap-0.5">
      {editable && (
        <Link href={`/compose/${postId}`} className="icon-btn" aria-label="Edit" title="Edit">
          <Pencil className="size-4" />
        </Link>
      )}
      {(status === "failed" || status === "partial") && (
        <button
          className="icon-btn"
          aria-label="Retry"
          title="Retry"
          disabled={pending}
          onClick={() => start(() => retryPost(postId))}
        >
          <RotateCw className="size-4" />
        </button>
      )}
      <button
        className="icon-btn"
        aria-label="Duplicate"
        title="Duplicate"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const id = await duplicatePost(postId);
            if (id) router.push(`/compose/${id}`);
          })
        }
      >
        <Copy className="size-4" />
      </button>
      <button
        className="icon-btn icon-btn-danger"
        aria-label="Delete"
        title="Delete"
        disabled={pending}
        onClick={() => {
          // Only removes it from Posty; anything already live stays on the network.
          if (window.confirm("Delete this post from Posty? Anything already posted stays on the network.")) {
            start(() => deletePost(postId));
          }
        }}
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}
