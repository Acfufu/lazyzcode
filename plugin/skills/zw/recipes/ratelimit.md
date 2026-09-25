# Recipe: rate-limit discipline (provider concurrency)

Model access is a provider-side concurrency quota shared across ALL your sessions
(GLM plans cap it per tier — Max > Pro > Lite; error `1302` / 429 `rate_limited`
means the account hit it). This is NOT the 3-continue Stop pool from
`recipes/continuation.md` — two different pools, never confuse them.

- **One active goal loop at a time.** Do not run several `zw` loops in parallel
  sessions; serialize batches instead.
- **Subagent parallelism is measured, not guessed.** `lzy loop start` prints a
  并发纪律 line — a parallelism cap computed from your real 429 data (recent hits, the
  measured concentration window, the empirical concurrency band). Follow it: cap 1 =
  run explorer / plan-reviewer / qa-executor strictly one at a time; cap 2 = go
  parallel only to capture several independent F-item evidences. No advisory printed
  (no log data) → assume the conservative default of ≤2 for independent captures
  only.
- **A turn died with 429/`1302 rate limited`?** Do not retry-bomb, do not replan.
  Close the session cleanly — `.lazyzcode/` lost nothing — and tell the user to
  resume with `zw 继续` after a few minutes, when the quota window has room again.
- **A turn died without reaching the server at all** (transport death:
  `connect ENETDOWN` / `ECONNRESET`-family errors — local network or proxy tunnel
  flap; the engine often mislabels these `retryable=false`)? Same contract: close
  cleanly, lose nothing, resume after the link recovers. `lzy doctor`'s `transport`
  line tallies this family separately — never treat it as quota pressure.
- **A turn died mid-stream with `[1301]`** (provider content moderation killed the
  stream after generation started; the engine often shows it as `reason=unknown`)?
  Do NOT retry the same prompt: it reproduces deterministically. Close the session
  cleanly and resume in a NEW session, or rephrase so the model takes a different
  reasoning path. `lzy doctor`'s `content` line tallies this family separately — not
  quota pressure.
- **Risk trumps quota.** HEAVY costs more calls (review gate, evidence capture, Stop
  pulls); when quota is tight, genuinely contained work may start LIGHT — but
  anything risky or vague is HEAVY regardless of quota. Applies only at triage; once
  engaged, never downgrade.
- **Before multi-session work**, run `lzy doctor`: its `rate-limit` line reports your
  account's recent 429 pressure and empirical concurrency band (or one-sided evidence
  when no coherent band exists — degradation is the normal path under attribution
  drift).
- **Repo-wiki generation shares your pool.** The desktop app's repo-wiki feature runs
  as a background lane on the same account model quota — while a large repo wiki is
  generating, avoid stacking dense unattended wake-ups on top of it.
- **Idle run is the official off-peak lane.** Host-granted OffPeak idle tasks run
  server-side off-peak and do not consume plan quota on the scheduling/concurrency
  side (start time not guaranteed). The provider **model pool** is a different axis:
  the repo-wiki sharing caveat above still applies, and a dying idle turn follows the
  same close-clean contract as any other death.
