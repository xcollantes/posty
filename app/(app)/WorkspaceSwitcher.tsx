"use client";

import { usePathname } from "next/navigation";
import { switchWorkspace } from "@/app/actions/workspaces";

export function WorkspaceSwitcher({
  workspaces,
  current,
}: {
  workspaces: { workspaceId: string; name: string }[];
  current: string;
}) {
  const path = usePathname();
  return (
    <select
      aria-label="Workspace"
      defaultValue={current}
      className="min-w-0 max-w-44 cursor-pointer truncate rounded-xl border border-white/10 bg-chrome px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/10"
      onChange={async (e) => {
        await switchWorkspace(e.target.value);
        // Reason: a full load drops the old workspace's client state (a half-written
        // post, the media grid) and filters like ?account= that don't apply here.
        window.location.assign(path.startsWith("/compose/") ? "/posts" : path);
      }}
    >
      {workspaces.map((w) => (
        <option key={w.workspaceId} value={w.workspaceId}>
          {w.name}
        </option>
      ))}
    </select>
  );
}
