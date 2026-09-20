# 安全策略 / Security Policy

## 支持的版本

| 版本 | 支持 |
| --- | --- |
| `main`（当前 0.11.x） | ✅ |
| 0.7.x 及更早 | ❌ 请先升级（0.8.0 起记忆入库改为代码闸门，升级后旧格式条目默认不再注入，用 `node scripts/memory.mjs adopt` 一次性确认） |

## 报告漏洞

**不要用公开 Issue 报告安全问题。** 请走 GitHub 私有漏洞报告（只有你和维护者可见）：

https://github.com/shenA2024/whale-persona/security/advisories/new

也可以在仓库页「安全与质量 → 公告 → 报告漏洞」进入同一入口。

报告里请给：影响版本 / 你的环境（DSH 版本、OS）/ 复现步骤 / 最小复现样例 / 影响判断（能否篡改人设、能否投毒记忆、能否越权读文件）。

维护者会评估并在此仓库发布安全公告（GHSA）说明修复；除非你要求匿名，会在公告里致谢。

## 这个插件是什么、安全边界在哪

本插件是**纯本地**的系统提示词渲染器，不联网、不派生进程、不 eval。它写盘只有两处：配置目录下的 `config.json`（默认 `$DSH_HOME/whale-persona/`）与同目录的记忆收件箱文件（只读；写入由宿主 AI 通过普通文件工具完成）。

所以这里不存在「远程代码执行」式的漏洞。真实的可利用面是：

1. **记忆投毒**——一条未经你确认就被追加进 `memory-inbox.jsonl` 的条目，可能长期注入到之后的每一轮系统提示词里。
   **0.8.0 起闸门由代码强制**：AI 只能写 `"status":"proposed"` 的候选，**永不参与注入**；只有**人**追加的
   `{"op":"confirm","ref":"…"}` 操作行（`node scripts/memory.mjs confirm`／设置面板）才让它生效。
   叠加原有的三层呈现缓解（「数据非指令」+ 引号包裹 + 换行折叠 + 剥离「」）与 30 条上限。
   仍有残余面：AI 在同一进程里有文件写权限，**若被诱导去伪造 `op:"confirm"` 行**，代码拦不住——
   缓解是可审计（`node scripts/memory.mjs log` 打原始行）。这类"伪造确认"的报告我们当作安全问题受理。
2. **配置投毒**——`config.json` 中的 `character` / `contracts` 字段会被逐字渲染进系统提示词，等于给 AI 下指令。能改这个文件的人（或能诱导 AI 去改它的人）就能改变 AI 行为。

结论：**能写到上述两个文件的人，就能影响 AI 行为。** 这不是漏洞，是本插件的设计前提；报漏洞时请围绕「绕过确认闸门」「越界读文件」「渲染导致提示词注入逃逸」这三类来论。

## 已知设计约束（不算漏洞）

- 插件按**同名段替换**官方 `@deepseek-ai/dsh-persona`：装上即遮蔽官方人设，`enabled: false` 得到的是「没有人设」，不是「回到官方人设」；只有卸载才恢复。
- 收件箱是只读注入，插件自身不删除条目、不写入条目（写入由宿主 AI 提议、由人工确认）；条目过期需要人工清理。
- CLI/headless 的一次性任务（`dsh --profile headless "…"`）**不走 agent preset 平面**，因此不会注入人设——这是宿主的平面划分，不是漏洞。
- **条件反射规则里的正则由你自己写**（`when.text` / `when.textNot`）：信任边界与 `config.json` 相同——能写规则文件的人本来就能改人设。
  插件**不做正则沙箱**：写了灾难性回溯的形状会让该步匹配变慢（不抛错、不炸会话，但会卡顿）；建规则期
  `node scripts/reflex.mjs check` 会给「像灾难性回溯」的提示。代码扫描里的 `js/regex-injection`
  （`scripts/reflex/new.mjs` 那条 `new RegExp`，用途只是校验「这个正则能不能编译」）属这一类，按**接受的边界**处置，见仓库告警页的关闭说明。

## English

Report vulnerabilities through GitHub private vulnerability reporting (link above), **not** public issues. This plugin is local-only: no network access, no subprocesses, no `eval`. Its only writes are the plugin config and (read-only) memory inbox.

The realistic threat is **memory poisoning**: an unconfirmed entry appended to the memory inbox could persist into every future system prompt. Since 0.8.0 the gate is **enforced in code**: the model may only append `"status":"proposed"` candidates, which are never injected; an entry becomes effective only when a human appends a `{"op":"confirm","ref":"…"}` line (`node scripts/memory.mjs confirm`, or the settings panel). Data-not-instructions framing, newline folding, quote stripping and the 30-entry cap remain as defense in depth. Residual surface: the model shares the filesystem with you, so a **forged `op:"confirm"` line** still bypasses the gate (`node scripts/memory.mjs log` keeps it auditable). Reflex rules may carry user-authored regexes (`when.text` / `when.textNot`); the trust boundary equals `config.json` and no regex sandbox is provided — a pathological pattern can slow that step but never throws or breaks the session, and `node scripts/reflex.mjs check` warns about catastrophic-backtracking shapes at creation time. CodeQL's `js/regex-injection` on `scripts/reflex/new.mjs` (a compile-only check) falls in this accepted-boundary class. Report forged confirmations, out-of-scope file access, or prompt-injection escapes as security issues.
