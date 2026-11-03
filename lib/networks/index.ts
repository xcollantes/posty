import type { NetworkId } from "./catalog";
import type { Network } from "./types";
import { bluesky } from "./bluesky";
import { facebook } from "./facebook";
import { instagram } from "./instagram";
import { linkedin } from "./linkedin";
import { mastodon } from "./mastodon";
import { pinterest } from "./pinterest";
import { threads } from "./threads";
import { tiktok } from "./tiktok";
import { x } from "./x";
import { youtube } from "./youtube";

export const networks: Record<NetworkId, Network> = {
  facebook,
  instagram,
  threads,
  x,
  linkedin,
  pinterest,
  youtube,
  tiktok,
  bluesky,
  mastodon,
};

export function getNetwork(id: string): Network {
  const n = networks[id as NetworkId];
  if (!n) throw new Error(`Unknown network: ${id}`);
  return n;
}
