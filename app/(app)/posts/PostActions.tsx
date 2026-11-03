"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { deletePost, duplicatePost, retryPost } from "@/app/actions/posts";

export function PostActions({ postId, status }: { postId: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const editable = status === "draft" || status === "scheduled" || status === "failed";
  return (
    <div className="flex gap-3 whitespace-nowrap">
      {editable && <Link href={`/compose/${postId}`}>Edit</Link>}
      {(status === "failed" || status === "partial") && (
        <button className="link-btn" disabled={pending} onClick={() => start(() => retryPost(postId))}>
          Retry
        </button>
      )}
      <button
        className="link-btn"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const id = await duplicatePost(postId);
            if (id) router.push(`/compose/${id}`);
          })
        }
      >
        Duplicate
      </button>
      <button
        className="danger-btn"
        disabled={pending}
        onClick={() => {
          // Only removes it from Posty; anything already live stays on the network.
          if (window.confirm("Delete this post from Posty? Anything already posted stays on the network.")) {
            start(() => deletePost(postId));
          }
        }}
      >
        Delete
      </button>
    </div>
  );
}
