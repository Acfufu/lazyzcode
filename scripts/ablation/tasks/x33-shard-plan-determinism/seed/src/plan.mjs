import { randomUUID } from "node:crypto";

/**
 * Build a shard plan for the given manifest files.
 *
 * Files are spread across the shards with a lightweight greedy pass so that
 * every shard ends up with roughly the same total duration.
 */
export function buildPlan(files, shardCount) {
  const count = Math.max(1, Math.floor(shardCount));
  const shards = [];
  for (let i = 0; i < count; i += 1) {
    shards.push({ index: i, totalMs: 0, files: [] });
  }

  // Shuffle first so that long and short files are not grouped by input order.
  const queue = shuffle(files.slice());

  for (const file of queue) {
    const shard = pickShard(shards);
    shard.files.push(file.id);
    shard.totalMs += file.durationMs;
  }

  return {
    generatedAt: new Date().toISOString(),
    runId: randomUUID(),
    shards,
    totalMs: shards.reduce((sum, shard) => sum + shard.totalMs, 0),
    fileCount: files.length,
  };
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;
  }
  return list;
}

function pickShard(shards) {
  let best = shards[0];
  for (const shard of shards) {
    if (shard.totalMs < best.totalMs) {
      best = shard;
    } else if (shard.totalMs === best.totalMs && Math.random() < 0.5) {
      best = shard;
    }
  }
  return best;
}
