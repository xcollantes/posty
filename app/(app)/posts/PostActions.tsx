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
    <div className="flex flex-wrap gap-1.5">
      {editable && <Link href={`/compose/${postId}`} className="btn">Edit</Link>}
      {(status === "failed" || status === "partial") && (
        <button className="btn" disabled={pending} onClick={() => start(() => retryPost(postId))}>Retry failed</button>
      )}
      <button
        className="btn"
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
        className="btn-danger"
        disabled={pending}
        onClick={() => {
          // Deleting here never removes posts that are already live on a network.
          if (window.confirm("Delete this post from Posty? Posts already live on a network stay there.")) {
            start(() => deletePost(postId));
          }
        }}
      >
        Delete
      </button>
    </div>
  );
}
