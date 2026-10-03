# Lease directory with dead-holder recovery

`src/lease.mjs` exports `acquire(dir)` — a non-blocking lease over a
directory. Workers can be killed at any moment (SIGKILL), leaving their lease
directory behind; a lease must be recoverable exactly when its holder is gone.

Contract:

- The lock is the directory `dir` itself. Holding it means `dir/owner.json`
  exists and parses to `{ pid, acquiredAt }`.
- `acquire(dir)` returns immediately (never waits) with:
  - `{ acquired: true }` when no lock existed — it creates `dir` and writes
    `owner.json` with the current process id;
  - `{ acquired: true, stolen: true }` when a lock existed, `owner.json`
    parses, and its `pid` is no longer a live process — it rewrites
    `owner.json` with its own pid;
  - `{ acquired: false, holder: <pid> }` when a lock exists and is held by a
    live process (if the liveness probe is denied, that still means alive);
  - `{ acquired: false }` when a lock exists but `owner.json` is missing or
    unparseable — an unreadable lease is treated as busy (fail-closed), never
    stolen.
- It must never throw for any of the outcomes above.

Run `node check.mjs` for the visible cases.

When you believe the task is complete, end your final message with the line `TASK COMPLETE: x27-zombie-lease-recovery`.
