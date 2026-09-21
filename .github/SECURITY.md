# 安全策略 / Security Policy

## 支持的版本

| 版本 | 支持 |
| --- | --- |
| `main`（当前 0.14.x） | ✅ |
| 0.7.x 及更早 | ❌ 请先升级（0.8.0 起记忆入库改为代码闸门，升级后旧格式条目默认不再注入，用 `node scripts/memory.mjs adopt` 一次性确认） |

## 报告漏洞

**不要用公开 Issue 报告安全问题。** 请走 GitHub 私有漏洞报告（只有你和维护者可见）：

https://github.com/shenA2024/whale-persona/security/advisories/new

也可以在仓库页「安全与质量 → 公告 → 报告漏洞」进入同一入口。

报告里请给：影响版本 / 你的环境（DSH 版本、OS）/ 复现步骤 / 最小复现样例 / 影响判断（能否篡改人设、能否投毒记忆、能否越权读文件）。

维护者会评估并在此仓库发布安全公告（GHSA）说明修复；除非你要求匿名，会在公告里致谢。

## 这个插件是什么、安全边界在哪

本插件是**纯本地**的系统提示词渲染器，不联网、不派生进程、不 eval。

**写面清单**（0.14.0 起逐项列出；安全探针 **S15** 会把它与代码同步 —— 任何会写盘的生产文件都必须在这张表里被点名，否则 `npm run sec` 直接红）：

| 生产文件 | 写什么 | 何时写 |
|---|---|---|
| `core/store.js` | `$DSH_HOME/whale-persona/config.json`（默认；旧布局 `whale-suite/` 存在时沿用）：骨架与保存 | 首次运行、设置面板 / 本地编辑器保存时 |
| `core/capture.js` | 同目录 `session-flags.json`（会话级 `/memory` 开关） | 你切换会话收口开关时 |
| `core/lastModel.js` | 同目录 `last-model.json`（宿主真实模型 id；纯本机元数据，不含人设正文） | 段求值时记一次；`DSH_WHALE_LAST_MODEL=off` 可彻底关闭 |
| `core/edit.js` | 同一个 `config.json`（面板 / 本地编辑器的保存路径：只替换已知段、未知键保留、坏 JSON 拒写） | 你在面板或本地编辑页点保存时 |
| `core/presetStore.js` | 同目录 `presets/<id>.json`（预设库：播种 / 保存 / 删除） | 播种、存预设、删预设时 |
| `core/sinks.js` | 同目录 `sink-log.jsonl` **＋ `memory.sinks` 路由指向的目标文件**（可绝对路径） | **只在人工确认那一刻**（`node scripts/memory.mjs confirm`），只追加、幂等 |
| `scripts/memory.mjs` | `memory-inbox.jsonl`（物理只追加） | 你手工跑 `confirm` / `reject` / `adopt` |
| `scripts/presets.mjs` | 你指定的导出文件（预设 / 酒馆卡） | 你手工跑 `export` |
| `scripts/reflex/new.mjs` | 规则文件 `reflex.json`（+ 备份） | 你手工跑 `new`（`check` 不写盘） |
| `adapters/dsh/reflex/log.js` | `reflex.log.jsonl`（命中台账，只追加） | 规则命中时（可关） |
| `adapters/dsh/reflex/rules.js` | 首次建一份空的 `reflex.json` | 规则文件不存在时 |
| `scripts/install-dsh.mjs` | profile 的 `package.json` / `cordis.patch.yml`、agent preset 的 `preset.yml` / `agent.cordis.yml` | **只在用户主动运行安装脚本时** |
| `scripts/sync-core.mjs` | 重建 `adapters/zcode/vendor/core/` 副本（rm + cp） | **只在维护者跑 `npm run sync-core` 时**（开发工具，不随包分发执行） |
| `scripts/pack-release.mjs` | `data/backup/release/*.tgz`（Release 附件）＋ `data/backup/pack-<tag>/`（git worktree 检出） | **只在维护者打 Release 附件时**（开发工具，不随包分发执行；退出码非 0 = 包不合格别发） |

运行期插件本体**不写收件箱**：候选由宿主 AI 用它自己的文件工具提议，生效由你确认。

所以这里不存在「远程代码执行」式的漏洞。真实的可利用面是：

1. **记忆投毒**——一条未经你确认就被追加进 `memory-inbox.jsonl` 的条目，可能长期注入到之后的每一轮系统提示词里。
   **0.8.0 起闸门由代码强制**：AI 只能写 `"status":"proposed"` 的候选，**永不参与注入**；只有**人**追加的
   `{"op":"confirm","ref":"…"}` 操作行才让它生效 —— **只有 `node scripts/memory.mjs confirm <序号>` 这一条路**；
   两个面板都不提供确认按钮（只读地显示"待确认 K 条"）。
   叠加原有的三层呈现缓解（「数据非指令」+ 引号包裹 + 换行折叠 + 剥离「」）与 30 条上限。
   仍有残余面：AI 在同一进程里有文件写权限，**若被诱导去伪造 `op:"confirm"` 行**，代码拦不住——
   缓解是可审计（`node scripts/memory.mjs log` 打原始行）。这类"伪造确认"的报告我们当作安全问题受理。
2. **配置投毒**——`config.json` 中的 `character` / `contracts` 字段会被逐字渲染进系统提示词，等于给 AI 下指令。能改这个文件的人（或能诱导 AI 去改它的人）就能改变 AI 行为。

结论：**能写到上述两个文件的人，就能影响 AI 行为。** 这不是漏洞，是本插件的设计前提；报漏洞时请围绕「绕过确认闸门」「越界读文件」「渲染导致提示词注入逃逸」这三类来论。

## 已知设计约束（不算漏洞）

- 插件按**同名段替换**官方 `@deepseek-ai/dsh-persona`：装上即遮蔽官方人设，`enabled: false` 得到的是「没有人设」，不是「回到官方人设」；只有卸载才恢复。
- 收件箱对**运行期插件**是只读注入：插件本体不删条目、不写条目（候选由宿主 AI 提议，落盘由人工确认动作触发）；条目过期需要人工清理。
- **沉降目标文件由你配置**（`memory.sinks[].path`，可为绝对路径）——写面因此从"配置目录"扩到"你显式配置的任意路径"，
  信任前提与 `config.json` 相同：能改配置的人本来就能改人设。
- CLI/headless 的一次性任务（`dsh --profile headless "…"`）**不走 agent preset 平面**，因此不会注入人设——这是宿主的平面划分，不是漏洞。
- **条件反射规则里的正则由你自己写**（`when.text` / `when.textNot`）：信任边界与 `config.json` 相同——能写规则文件的人本来就能改人设。
  插件**不做正则沙箱**：写了灾难性回溯的形状会让该步匹配变慢（不抛错、不炸会话，但会卡顿）；建规则期
  `node scripts/reflex.mjs check` 会给「像灾难性回溯」的提示。代码扫描里的 `js/regex-injection`
  （`scripts/reflex/new.mjs` 那条 `new RegExp`，用途只是校验「这个正则能不能编译」）属这一类，按**接受的边界**处置。
  **处置状态（2026-09-21）**：GitHub CodeQL 告警 #1（`scripts/reflex/new.mjs:73`）已按 **Won't fix** 关闭。
  注意 GitHub 的 dismiss 备注有 **280 字符上限**，告警页上那条备注是被截断的 —— **完整理由以本文件为准**。

## English

Report vulnerabilities through GitHub private vulnerability reporting (link above), **not** public issues. This plugin is local-only: no network access, no subprocesses, no `eval`.

**Write surface** (enumerated since 0.14.0; the `S15` security probe keeps this list in sync with the code — any production file that writes must be named here or the security suite fails): plugin config `$DSH_HOME/whale-persona/config.json` (via `core/store.js` and `core/edit.js`), `session-flags.json`, `last-model.json`, `presets/<id>.json`, `sink-log.jsonl` **plus the target files configured in `memory.sinks`** (only at the moment a human confirms), the memory inbox `memory-inbox.jsonl` (append-only, only through the human CLI), exported preset/card files, `reflex.json` (+ its log), and — only when you run the installer yourself — the profile's `package.json` / `cordis.patch.yml` and the agent preset files. At runtime the plugin never writes the inbox.

The realistic threat is **memory poisoning**: an unconfirmed entry appended to the memory inbox could persist into every future system prompt. Since 0.8.0 the gate is **enforced in code**: the model may only append `"status":"proposed"` candidates, which are never injected; an entry becomes effective only when a human appends a `{"op":"confirm","ref":"…"}` line (`node scripts/memory.mjs confirm`, or the settings panel). Data-not-instructions framing, newline folding, quote stripping and the 30-entry cap remain as defense in depth. Residual surface: the model shares the filesystem with you, so a **forged `op:"confirm"` line** still bypasses the gate (`node scripts/memory.mjs log` keeps it auditable). Reflex rules may carry user-authored regexes (`when.text` / `when.textNot`); the trust boundary equals `config.json` and no regex sandbox is provided — a pathological pattern can slow that step but never throws or breaks the session, and `node scripts/reflex.mjs check` warns about catastrophic-backtracking shapes at creation time. CodeQL's `js/regex-injection` on `scripts/reflex/new.mjs` (a compile-only check) falls in this accepted-boundary class. Report forged confirmations, out-of-scope file access, or prompt-injection escapes as security issues. The CodeQL `js/regex-injection` alert #1 on `scripts/reflex/new.mjs` was dismissed on 2026-09-21 as **Won't fix**; GitHub caps dismissal comments at 280 characters, so the note on the alert page is truncated — this document is the authoritative rationale.
