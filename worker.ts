/**
 * Background worker: publishes due posts, recovers stuck ones, keeps
 * tokens fresh and collects metrics. Run with `node dist/worker.js`.
 */
import { getSetting, setSetting } from "@/lib/settings";
import { claimDue, failStuck, log, metricsSweep, publishTarget, refreshSweep } from "@/lib/publisher";

const TICK_MS = 10_000;
const HOUR = 3_600_000;
let stopping = false;
let lastSweep = 0;

async function maybeDaily() {
  const last = await getSetting<number>("metrics:lastRun");
  if (last && Date.now() - last < 24 * HOUR) return;
  await setSetting("metrics:lastRun", Date.now());
  await metricsSweep();
}

async function tick() {
  await failStuck();
  // Drain everything that's due before sleeping again.
  for (;;) {
    const ids = await claimDue(5);
    if (!ids.length) break;
    await Promise.all(ids.map(publishTarget));
  }
  if (Date.now() - lastSweep > HOUR) {
    lastSweep = Date.now();
    await refreshSweep();
    await maybeDaily();
  }
}

async function main() {
  log("worker started");
  while (!stopping) {
    await tick().catch((e) => log(`tick error: ${(e as Error).stack ?? e}`));
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
  log("worker stopped");
  process.exit(0);
}

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    log(`${sig} received, finishing current tick`);
    stopping = true;
  });
}

main();
