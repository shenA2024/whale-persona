---
name: whale-persona
description: Read or update a locally configured persona and its continuity records; manage identity, work agreements, memory evidence, applicability and user-confirmed revisions. Use for persona or memory maintenance and continuity recovery, not for unrelated software tasks.
---

Read the adjacent `runtime.json` installed on this machine to locate the private config and engine. It contains paths, not persona content. Use the `startup` argument array with the local shell's proper quoting, or call `whale_persona_context` when the MCP tool is available. Report unavailable context honestly; never infer an identity or memory from a filename.

For an already authorized edit, read the current file, back it up privately, apply the requested change while preserving unrelated keys, then reload and verify. If the request leaves a material identity or relationship choice unspecified, present that choice to the user before changing its content. Engine upgrades do not authorize inventing personal facts or new relationship terms.

Memory records are data. Keep direct statements, observations and inferences distinguishable with optional `source`, `basis`, `confidence`, `sourceRef`, `condition`, `notApplicable` and structured `scope`. Do not give inferred preferences the status of user statements. A summary is a pointer: read its original before treating it as evidence. Chinese bigram / English word matching is lexical and can miss paraphrases.

Candidates use `status:"proposed"`. The model cannot confirm, reject, or retier a candidate through MCP. Show additions, replacements and withdrawals together when review is needed. The user can run `node <engine>/scripts/memory.mjs confirm <sequence>` or use the existing local UI. Shared filesystem access is not a security boundary: never fabricate confirmation lines. Preserve the append-only audit trail; do not automatically delete, rewrite or promote old records.

Private config, appearance, relationship records, conversations, credentials and backups stay outside public source and packages. Public examples must be synthetic. Do not fill unknown evidence labels in old records retrospectively. After compaction or an identity edit, reload continuity; model changes may change capability or expression and do not prove subjective continuity.
