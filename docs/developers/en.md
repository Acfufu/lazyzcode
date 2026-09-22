# Under the hood

For developers who want to extend LazyZCode, contribute to it, or integrate
with it. Companion to the [Documentation](../guide/en.md): there the *workflow*,
here the *machinery*. Everything on this page is derived from the actual
source (`plugin/`, `core/`, `cli/`) — no aspirations, just what ships.

## System architecture

LazyZCode is three pieces with hard boundaries: a plugin the engine loads, a
CLI that owns the loop state, and a state directory your project keeps.

<figure class="diagram">
<svg viewBox="0 0 840 300" xmlns="http://www.w3.org/2000/svg" font-size="13">
  <defs>
    <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0L10 5L0 10z" fill="var(--accent)"/>
    </marker>
  </defs>
  <g fill="var(--surface-2)" stroke="var(--line-strong)">
    <rect x="20" y="70" width="190" height="76" rx="10"/>
    <rect x="300" y="40" width="240" height="104" rx="10"/>
    <rect x="620" y="40" width="200" height="60" rx="10"/>
    <rect x="620" y="150" width="200" height="60" rx="10"/>
    <rect x="300" y="190" width="240" height="60" rx="10"/>
  </g>
  <g fill="var(--text)" text-anchor="middle" font-weight="600">
    <text x="115" y="102">ZCode engine</text>
    <text x="420" y="66">lazyzcode:zw plugin</text>
    <text x="720" y="65">lzy CLI</text>
    <text x="720" y="175" class="mono" font-weight="400">.lazyzcode/</text>
    <text x="420" y="215">git repository</text>
  </g>
  <g fill="var(--muted)" text-anchor="middle" font-size="11.5">
    <text x="115" y="124">desktop app · zcode.cjs</text>
    <text x="420" y="88">skills/zw · orchestration text</text>
    <text x="420" y="107">hooks ×6 · via the run-hook launcher</text>
    <text x="420" y="126">agents ×3 · read-only roles</text>
    <text x="720" y="83">goal-loop state machine</text>
    <text x="720" y="193" class="mono" font-weight="400">goal.json · plans · evidence</text>
    <text x="420" y="233" class="mono" font-weight="400">HEAD^{tree}</text>
  </g>
  <g stroke="var(--accent)" stroke-width="1.4" fill="none">
    <path d="M210 90 H296" marker-end="url(#arr)"/>
    <path d="M620 55 C500 -8 330 -8 216 62" stroke-dasharray="5 4" marker-end="url(#arr)"/>
    <path d="M720 100 V146" marker-end="url(#arr)"/>
    <path d="M616 210 H544" marker-end="url(#arr)"/>
  </g>
  <g fill="var(--muted)" font-size="11.5">
    <text x="253" y="118" text-anchor="middle">loads plugin</text>
    <text x="253" y="133" text-anchor="middle">fires hook events</text>
    <text x="418" y="16" text-anchor="middle">official plugins enable · config.json untouched</text>
    <text x="728" y="128" text-anchor="start">reads / writes</text>
    <text x="580" y="200" text-anchor="end">evidence binds</text>
    <text x="580" y="215" text-anchor="end" class="mono">HEAD^{tree}</text>
  </g>
</svg>
<figcaption>Boundaries are deliberate: the installer never writes your
<code>config.json</code> (enabling flows through the engine's official
<code>plugins enable</code>), the loop state lives in the project, and the
plugin ships zero runtime dependencies.</figcaption>
</figure>

Design rule of thumb, in order: **Skill > MCP > Tool > Hook**. Anything that
survives being offline lives in skill text; hooks are the last resort and are
written to fail open.

## The goal loop, as a state machine

`lzy loop` is a plain state machine on disk (no daemon). The skill text drives
the model through it; the CLI gates every transition.

<figure class="diagram">
<svg viewBox="0 0 840 230" xmlns="http://www.w3.org/2000/svg" font-size="13">
  <defs>
    <marker id="arr2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0L10 5L0 10z" fill="var(--accent)"/>
    </marker>
  </defs>
  <g fill="var(--surface-2)" stroke="var(--line-strong)">
    <rect x="20" y="88" width="110" height="44" rx="10"/>
    <rect x="180" y="88" width="130" height="44" rx="10"/>
    <rect x="390" y="88" width="150" height="44" rx="10"/>
    <rect x="620" y="88" width="120" height="44" rx="10"/>
  </g>
  <rect x="772" y="94" width="52" height="32" rx="8" fill="var(--accent-dim)" stroke="var(--accent)"/>
  <g fill="var(--text)" text-anchor="middle" font-weight="600" font-size="12.5">
    <text x="75" y="115">register</text>
    <text x="245" y="115">plan gate</text>
    <text x="465" y="115">executing</text>
    <text x="680" y="115">finish gate</text>
    <text x="798" y="115" fill="var(--accent)">done</text>
  </g>
  <g stroke="var(--accent)" stroke-width="1.4" fill="none">
    <path d="M130 110 H176" marker-end="url(#arr2)"/>
    <path d="M310 110 H386" marker-end="url(#arr2)"/>
    <path d="M540 110 H616" marker-end="url(#arr2)"/>
    <path d="M740 110 H768" marker-end="url(#arr2)"/>
    <path d="M430 132 v34 h110 v-30" stroke-dasharray="5 4" marker-end="url(#arr2)"/>
    <path d="M465 46 V84" stroke-dasharray="5 4" marker-end="url(#arr2)"/>
  </g>
  <g fill="var(--muted)" font-size="11.5" text-anchor="middle">
    <text x="245" y="150">decision-complete</text>
    <text x="245" y="165">HEAVY: reviewer PASS</text>
    <text x="465" y="32">Stop hook pulls back · ≤2 per session</text>
    <text x="558" y="185">lzy step done · F items carry evidence</text>
  </g>
</svg>
<figcaption>Every transition is a CLI command; every gate is a check that can
refuse. The Stop hook is the only thing that can push the model back to work,
and it is budget-capped and fail-open by design.</figcaption>
</figure>

```bash
lzy loop register <slug> --title "…"
lzy loop plan <plan.md> --review "plan-reviewer: PASS …"
lzy loop start
lzy step done <ID> --evidence "curl /export -> 200, parses as CSV"
lzy loop finish
```

## Evidence binding

The core trick of the whole product: proof is bound to the content snapshot of
a commit, so it cannot quietly rot.

<figure class="diagram">
<svg viewBox="0 0 840 210" xmlns="http://www.w3.org/2000/svg" font-size="13">
  <defs>
    <marker id="arr3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0L10 5L0 10z" fill="var(--accent)"/>
    </marker>
  </defs>
  <path d="M40 120 H800" stroke="var(--line-strong)" stroke-width="1.4"/>
  <g fill="var(--bg)" stroke="var(--accent)" stroke-width="1.6">
    <circle cx="130" cy="120" r="7"/>
    <circle cx="420" cy="120" r="7"/>
    <circle cx="660" cy="120" r="7"/>
  </g>
  <g fill="var(--muted)" font-size="11.5" text-anchor="middle" class="mono">
    <text x="130" y="145">commit A · tree 95a0…</text>
    <text x="420" y="145">commits B… · tree c3f1…</text>
    <text x="660" y="145">commit C · tree 7d22…</text>
  </g>
  <rect x="45" y="24" width="230" height="58" rx="10" fill="var(--surface-2)" stroke="var(--line-strong)"/>
  <text x="160" y="47" fill="var(--text)" text-anchor="middle" font-weight="600">F-item evidence captured</text>
  <text x="160" y="67" fill="var(--accent)" text-anchor="middle" class="mono" font-size="11.5">bound: 95a0…</text>
  <path d="M160 82 V111" stroke="var(--accent)" stroke-width="1.4" stroke-dasharray="5 4" marker-end="url(#arr3)"/>
  <rect x="545" y="30" width="270" height="66" rx="10" fill="var(--surface-2)" stroke="var(--line-strong)"/>
  <text x="680" y="53" fill="var(--text)" text-anchor="middle" font-weight="600">finish re-checks freshness</text>
  <text x="680" y="73" fill="var(--muted)" text-anchor="middle" font-size="11.5">evidence from 95a0… is stale on 7d22…</text>
</svg>
<figcaption>Commit first, capture after. The moment the code changes, old
evidence is stale by construction and <code>lzy loop finish</code> refuses it;
<code>lzy step done</code> re-binds on recapture.</figcaption>
</figure>

Two deliberate consequences: `.lazyzcode/` itself never counts as a dirty
worktree, and "tests are green" is just one surface among several, never a
substitute for the named F-item surface.

## Hook lifecycle

Six hooks ride the engine's session timeline. All of them spawn through
`plugin/hooks/run-hook`, which resolves `node` from PATH, then nvm, then
Homebrew on POSIX (Windows resolves the same manifest line to the
`run-hook.cmd` twin via PATHEXT and falls back to nvm-windows/Program Files),
so a Dock-launched ZCode (whose hook environment has no node) still
works; the fallback path is reported by `lzy doctor`'s `hook-node` check.

<figure class="diagram">
<svg viewBox="0 0 840 190" xmlns="http://www.w3.org/2000/svg" font-size="13">
  <path d="M40 78 H800" stroke="var(--line-strong)" stroke-width="1.4"/>
  <g fill="var(--accent)">
    <circle cx="100" cy="78" r="7"/>
    <circle cx="236" cy="78" r="7"/>
    <circle cx="372" cy="78" r="7"/>
    <circle cx="508" cy="78" r="7"/>
    <circle cx="644" cy="78" r="7"/>
    <circle cx="780" cy="78" r="7"/>
  </g>
  <g fill="var(--text)" text-anchor="middle" font-weight="600" font-size="12.5" class="mono">
    <text x="100" y="52">SessionStart</text>
    <text x="236" y="52">UserPromptSubmit</text>
    <text x="372" y="52">PreToolUse</text>
    <text x="508" y="52">PostToolUse</text>
    <text x="644" y="52">PostToolUseFailure</text>
    <text x="780" y="52">Stop</text>
  </g>
  <g fill="var(--muted)" text-anchor="middle" font-size="11.5">
    <text x="100" y="106">re-inject loop state</text>
    <text x="100" y="123">into fresh sessions</text>
    <text x="236" y="106">trigger match →</text>
    <text x="236" y="123">inject zw bootstrap</text>
    <text x="372" y="106">command-layer H3R gate</text>
    <text x="372" y="123">(dormant prototype)</text>
    <text x="508" y="106">comment-checker nudge</text>
    <text x="508" y="123">(Edit / Write)</text>
    <text x="644" y="106">tripwire: same-tool</text>
    <text x="644" y="123">fail streak → warn once</text>
    <text x="780" y="106">request continuation</text>
    <text x="780" y="123">≤2 · handoff release</text>
  </g>
  <text x="420" y="165" fill="var(--faint)" text-anchor="middle" font-size="11.5">session-start.js · trigger.js · comment-checker.js · h3r-pretool.js · tripwire.js · stop.js — all spawned via the run-hook launcher</text>
</svg>
<figcaption>The engine exposes 7 hook events and a shared pool of 3
stop-continuations that background notifications also draw from; LazyZCode
spends at most 2 per session and always fails open.</figcaption>
</figure>

## Extending it

**Add a discipline role.** Drop a Markdown file with frontmatter into
`plugin/agents/`; the engine auto-discovers the directory. Roles are
read-only contracts: explorer (recon with `file:line` evidence),
plan-reviewer (`VERDICT: PASS | REVISE`), qa-executor (observed raw output,
never inference). Keep any new role's output contract machine-checkable.

**Trigger matching** lives in `plugin/hooks/trigger.js`, stratified on
purpose:

| Pattern | Fires |
| --- | --- |
| `/^\s*zw(?![a-z0-9_-])/i` | start of prompt only |
| `/lazyzcode[：:]zw/i` | anywhere, full-width colon included |
| `/(^|[^a-z0-9_-])(ulw|ultrawork)([^a-z0-9_-]|$)/i` | anywhere, word-bounded |

**Hook output contract:** only the Stop hook can continue a session, and only
with `{continue:true, additionalContexts:[non-empty]}` (the engine's own
contract); the other four hooks emit `{additionalContext}` — inject-only.
Anything else, including a crash, fails open and never traps the session.

**Configuration surface:** one environment variable. `LZY_ZCODE_ENGINE`
replaces the engine candidate list; everything else is derived from the repo
and engine state.

## Build, test, preview

```bash
npm test                      # node:test contract suite, zero deps
cd scripts/docs-preview       # dev-only toolchain (own package.json)
npm install
npm run build                 # docs/ -> dist/ (Jekyll emulation)
npm run check                 # link crawl + anchor integrity, exit 1 on any miss
```

CI runs the suite on node 22 / 24. The docs site builds on GitHub Pages
from `/docs` (Jekyll, GFM); `scripts/docs-preview/build.mjs` mirrors that
pipeline locally — Pages adds rouge syntax coloring on top, everything else
matches.

## Compatibility notes

- Engine layout detection covers macOS, Windows and Linux (ADR-0011); the
  distribution matrix is arm64-live-verified, x64 follows the official
  download matrix by documentation.
- The engine surface this targets: 7 hook events, ≤3 stop-continuations
  (shared pool), native AGENTS.md injection.
- Headless driving needs the desktop's injected credentials; mechanism is
  probe-validated, live acceptance deferred.

---

*LazyZCode is MIT. Workflow inspired by
[lazycodex](https://github.com/code-yeongyu/lazycodex) (MIT); OmO (SUL-1.0)
ideas only. Docs structure follows the lazycodex docs with credit.*
