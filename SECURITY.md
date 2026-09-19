# Security Policy

## Supported versions

Security fixes land on the latest minor line only.

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅ |
| 0.0.x and older | ❌ — upgrade with `lzy update` (pre-0.0.7 installs use the manual two-step documented in the README) |

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** (the repository's
*Security* tab → "Report a vulnerability") so details stay out of public view.
Do **not** open a public issue for anything exploit-shaped.

Where relevant, include:

- Your `lazyzcode` version (`lzy --version`) and platform (macOS / Windows /
  Linux, arch)
- The ZCode desktop engine version involved
- Steps to reproduce and the impact you observed
- `lzy doctor` output if the report involves hook execution or the CLI

The maintainer aims to acknowledge reports within 7 days and will keep you
informed of the fix and disclosure timeline. Fixes ship in a patch release;
credit in the changelog is yours unless you prefer otherwise.

## Scope

**In scope**

- Code in this repository (`cli/`, `core/`, `plugin/`) and the published npm
  package `lazyzcode`
- The marketplace manifest (`.claude-plugin/marketplace.json`) and everything
  the install/sync flow writes or executes
- Injection, path traversal, or state corruption in the goal-loop state under
  `.lazyzcode/`

**Out of scope**

- The ZCode engine and desktop app themselves — report those upstream
- Issues that require physical access to the machine or social engineering
- The behavior or output of the models behind the engine

## Design posture

What this project promises about its own security surface:

- **Zero telemetry.** Nothing leaves your machine; diagnostics are computed
  and printed locally by `lzy doctor`.
- **`config.json` is never written.** Install = plugin cache placement +
  registry write; enable = the engine's official `plugins enable` (ADR-0001).
- **Hooks fail open.** A missing or broken hook environment degrades the
  discipline layer, never the host session.
- **All state is local**, under `.lazyzcode/` and the ZCode plugin cache.
- **Spawn sites use literal argv with `shell: false`**, including the
  Windows `cmd` paths, which go through `ComSpec /d /s /c` with literal
  strings.

These properties are contract-tested. If you find a violation, that is a
security-relevant report — please follow the private reporting channel above.
