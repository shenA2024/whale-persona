# whale-persona — a persona engine for AI coding harnesses

[![CI](https://github.com/shenA2024/whale-persona/actions/workflows/ci.yml/badge.svg)](https://github.com/shenA2024/whale-persona/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![node >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)
[![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](package.json)

**简体中文** | English

> **This is the English guide, not a second source of truth.** [README.md](README.md) (Chinese) and
> [SPEC.md](SPEC.md) (Chinese) are authoritative — they are updated first, and they carry the full
> detail: every field, the exact bytes of every injected section, every known pitfall. Translating
> them in full would create two documents that drift apart (exactly the failure mode this project
> writes tests against), so this file stays a guide: what the engine is, how to install it, what each
> feature does, and where to read more.

## What it is

whale-persona turns the *persona* of an AI coding assistant into a JSON config you own: self-name
(tiered by model), how it addresses you, its stance, its character text, per-item work contracts you
can toggle, the language it thinks in, self-image and reply tone (both opt-in, both overridable per
model), and a long-term memory inbox whose entries only take effect after an explicit human `confirm`
line — enforced in code, not merely asked for in the prompt.

One `config.json` plus one append-only inbox file, shared by two hosts. **DeepSeek Harness** is the
primary host; the **ZCode adapter is retired** (2026-09-19) and kept for history only — no further
development, no real-machine regression runs, not first in line for fixes. Persona presets, SillyTavern
card import and the `dsh.bundle` patch all target the harness and are unrelated to ZCode.

MIT · pure ESM · zero runtime dependencies · never touches the network · any error degrades to an
empty section (worst case: no persona — never a broken session).

## The problem it solves

All the things you end up re-explaining to a coding assistant every single time: it forgets, you
repeat; the same task gets a different style on Tuesday; "stop asking me whether to continue" has been
said a hundred times and it still asks.

whale-persona makes those persona facts **a config you write once**, attached automatically to every
session. It ships blank and changes nothing until you fill it in — and it differs from "automatic
memory" approaches in one hard way: **nothing is remembered until you confirm it**, and that gate is
code, not a prompt request.

**See the output before installing** (read-only, touches nothing):

```bash
node scripts/render-preview.mjs --config examples/demo-config.json --cwd D:/work/demo
```

It prints the exact three sections that would be injected into the system prompt — that is what you
get after installing.

## What you get

| Capability | What it does |
|---|---|
| Self-name / address | `{selfName}` / `{userName}` placeholders; the self-name can be set **per concrete model id** (`selfNameByModel`), falling back to a flash / pro tier |
| Stance & character | `stance` (one line) and `character` (full text), rendered at the very top of the prompt |
| Appearance | opt-in, **off by default**: who you are, injected as a *given fact* (`text` as fallback + `byModel` overrides keyed by the **host's real model id**) |
| Appearance cards (0.17.0) | `appearance.cards`: one card each for yourself / the user / third parties — title, one-line brief, long detail, photo **paths**. Brief stays resident, detail and photos are read on demand; images never enter the prompt (path only) |
| Reply tone | opt-in, **off by default**: changes wording and rhythm only — never conclusions, evidence standards or the work contract |
| Work contracts | Individually toggleable (`on:false` disables one); only concrete, checkable rules actually work |
| Thinking language | Changes the language of the model's *reasoning* only, not its replies |
| Long-term memory | Manual entries (authoritative tier) + an inbox (AI proposes → **human confirms** → append-only) |
| Memory tiering (0.17.0) | Entries carry `tier`: `core` is always injected and exempt from the cap, `hot`/unspecified compete, `cold` is indexed only. Entries that are **not** expanded still appear in a 【memory index】 block with their replay-view number, so the model knows what exists and where to read it |
| Classification sinks (0.13.0) | The same confirmation gate, extended past memory: tag an entry with a `kind` and the moment you confirm it, it is appended to the target file you configured (`memory.sinks`). Never injected, idempotent, unmapped kinds are named out loud |
| Injection size (0.13.0) | Measures characters per section through the *same code path* as rendering; optional over-budget reminder line — it warns, it never trims your config |
| Conditioned reflex | User-written rules matched **in code** inject a one-step directive (regex / normalized substring / keyword bag). Matching costs no tokens; optional per-step request slimming and tool narrowing; empty by default |
| Two editors | Harness settings panel + a local editor page, sharing one write discipline |
| Zero behaviour change | No config = three empty sections; covered by unit tests |
| Default-safe | No network, no shell, never reads your working directory; every write location is registered in [.github/SECURITY.md](.github/SECURITY.md) and kept in sync by the safety probe (an unregistered new file turns the security suite red) |

Ready-made persona text lives in a companion repo — the engine itself ships blank and opinion-free:

> **[whale-persona-presets](https://github.com/shenA2024/whale-persona-presets)** — preset cards for
> general work, evidence-first reasoning, explaining to non-experts, editorial de-watering, strict
> review, requirement clarification, debugging, refactoring, data reading, product review, sparring,
> research notes, Chinese-to-English, security review, prompt engineering, multi-agent split.

Import is the path that already exists:

```bash
node scripts/presets.mjs import starter-plus.json   # a downloaded card
node scripts/presets.mjs list                       # what do I have
node scripts/presets.mjs apply starter-plus         # apply (an autosave is created first)
```

## Install in 60 seconds

**① Install (DeepSeek Harness)** — one command: package + preset + default + skill + self-check:

```bash
npx -y whale-persona     # no clone needed; restart the harness afterwards
```

Requirements: **Node ≥ 20**, **DSH ≥ 0.1.6-alpha.1**, and a **restart** afterwards.

**No npx?** Clone and run the same installer:

```bash
git clone https://github.com/shenA2024/whale-persona.git
cd whale-persona
node scripts/install-dsh.mjs --dry-run   # see what it would do
node scripts/install-dsh.mjs             # do it
```

**Neither?** Use the tarball attached to a release (byte-identical to `npm pack` output):

```powershell
dsh plugin --profile web add -w https://github.com/shenA2024/whale-persona/releases/download/v0.15.1/whale-persona-0.15.1.tgz
```

⚠️ **Only the tarball path needs two steps.** `npx` and the clone path run the same installer, which
does everything at once; the tarball path only puts the package into the profile, so run the bundled
installer once more:

```powershell
node "$env:USERPROFILE\.dsh\profiles\web\node_modules\whale-persona\scripts\install-dsh.mjs"
```

Then restart the harness. The installer creates a preset named `whale-persona` by **copying your
current default preset** (it does not overwrite it) and tells you how to switch to it.

**The blank default is deliberate.** Only one field really matters: `persona.character`. Self-name
defaults to "I", the user address defaults to "user"; stance, tone, appearance and work contracts are
all optional and off by default. Two ways to start: import a card from the presets repo, or just tell
your assistant "add a contract: no closing 'would you like me to…' questions".

**Install fails?** Two errors are common and documented verbatim in the Chinese README: GitHub being
unreachable from your network (configure a proxy for git, or use the tarball path), and pnpm blocking
build scripts of git-hosted plugins (`allowBuilds` in the profile's `pnpm-workspace.yaml`).

**② Configure** — pick one:

```bash
# a) just ask the assistant (with the bundled skill installed)
# b) local editor page:
node scripts/ui.mjs                     # http://127.0.0.1:8787
# c) exact preview of the injected text:
node scripts/render-preview.mjs --config examples/demo-config.json --capture
```

Everything is evaluated per step, so config edits take effect on the next step — but adding or
removing *mount lines* requires a host restart.

### Why does a new agent preset appear?

Because the persona has nowhere else to live. The host's built-in presets are shipped files (you
cannot edit or delete them without the next update overwriting you), and mounting the persona at the
profile level collides with the deployment-level registration of the same section name — which stops
the whole harness from starting. Copying an existing preset and changing that one line is the host's
own extension mechanism. So "custom persona" is not a redundant layer: **it is where the persona
mounts**. Only sessions bound to that preset have a persona; a session cannot switch presets once it
has produced content.

## Configuration, files and commands

| What | Where |
|---|---|
| Config | `$DSH_HOME/whale-persona/config.json` (older layout `$DSH_HOME/whale-suite/` is honoured if it exists) |
| Memory inbox | same directory, `memory-inbox.jsonl` — append-only, replayed line by line |
| Presets | same directory, `presets/*.json` |
| Last real model id | same directory, `last-model.json` (local metadata only, deletable) |

```bash
node scripts/memory.mjs status          # candidates, their sequence numbers and kinds
node scripts/memory.mjs confirm 2       # confirm #2: append the confirm line, route by kind, dequeue
node scripts/appearance.mjs show aming  # read one appearance card in full
node scripts/inject-size.mjs --cwd .    # per-section character counts and budget verdict
node scripts/doctor.mjs                 # coexistence check: which names we occupy, who else claims them
```

Format-level documentation for third-party implementations is [SPEC.md](SPEC.md) (Chinese): config
shape, the exact assembly contract for injected text, the preset-card format, the SillyTavern card
mapping. Mounting details: [adapters/dsh/README.md](adapters/dsh/README.md).

## Memory: the AI may propose, only a human confirms

Every line the AI writes into the inbox must be `{"text":"…","status":"proposed"}` — a candidate, never
injected. The only action that makes an entry live is a **human** appending
`{"op":"confirm","ref":"…"}` — via `node scripts/memory.mjs confirm <n>`. The file is physically
append-only: confirm, reject, supersede and drop are all additional lines, one bad line never breaks
the box, and the injected view is produced by replaying the log in order.

**Residual risk, stated plainly:** the AI has file-write access within one process, so in principle it
could be induced to forge a `confirm` line. That is the inherent ceiling of same-process file-level
trust. Mitigations are audibility (`memory.mjs log` prints raw lines) and the data-not-instructions
presentation of everything injected. Details in [.github/SECURITY.md](.github/SECURITY.md).

## Safety and privacy

- No network, no shell, never reads your working directory; every write location is listed in
  [.github/SECURITY.md](.github/SECURITY.md) and cross-checked by a probe — adding a write without
  registering it fails the security suite;
- The memory gate is code-enforced (see above);
- The installer spawns no shell: it locates the harness entry point itself and passes argument arrays
  to `process.execPath`; `--profile` / `--base` are whitelist-validated;
- The local editor page binds 127.0.0.1 only, validates the `Host` header, uses a one-shot CSP nonce
  and a JSON-only write endpoint;
- `npm run sec` runs the probe (`qa/probes/probe-security.js`) plus `--selftest`, which plants
  violations in a temp root and asserts the probe actually fails — a probe that cannot fail proves
  nothing. The safety ledger with manual review items is [qa/security-审查.md](qa/security-审查.md).

## Repository layout

```text
core/            host-independent rendering core (the single source of truth)
SPEC.md          format spec v1: config, injection assembly contract, preset cards, Tavern mapping
examples/        runnable examples: demo config, demo inbox, empty config
adapters/dsh/    the harness half: persona sections, thinking-language section, reflex layer
adapters/dsh-ui/ harness settings panel (host routes + browser half)
adapters/zcode/  retired ZCode plugin (history only)
scripts/         installer, render preview, local editor, memory console, appearance cards,
                 injection size, doctor, reflex rules, core→vendor sync
tests/           19 test files, run with npm test
qa/              safety probe + manual review ledger
```

## Development

```bash
npm test                 # all 19 test files
npm run sec              # safety probe: 16 automated groups + self-test
npm run sync-core        # after editing core/: refresh the vendored copy (a test verifies it)
npm run prepublish-check # release gate: package contents, private-content word scan, spec drift
```

## License

MIT © 2026 shenA2024
