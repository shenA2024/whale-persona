# 安全策略 / Security Policy

## 支持的版本

| 版本 | 支持 |
| --- | --- |
| `main`（当前 0.3.x） | ✅ |
| 0.2.x 及更早 | ❌ 请先升级 |

## 报告漏洞

**不要用公开 Issue 报告安全问题。** 请走 GitHub 私有漏洞报告（只有你和维护者可见）：

https://github.com/shenA2024/whale-persona/security/advisories/new

也可以在仓库页「安全与质量 → 公告 → 报告漏洞」进入同一入口。

报告里请给：影响版本 / 你的环境（DSH 版本、OS）/ 复现步骤 / 最小复现样例 / 影响判断（能否篡改人设、能否投毒记忆、能否越权读文件）。

维护者会评估并在此仓库发布安全公告（GHSA）说明修复；除非你要求匿名，会在公告里致谢。

## 这个插件是什么、安全边界在哪

本插件是**纯本地**的系统提示词渲染器，不联网、不派生进程、不 eval。它写盘只有两处：配置目录下的 `config.json`（默认 `$DSH_HOME/whale-persona/`）与同目录的记忆收件箱文件（只读；写入由宿主 AI 通过普通文件工具完成）。

所以这里不存在「远程代码执行」式的漏洞。真实的可利用面是：

1. **记忆投毒（最现实）**——一条未经你确认就被追加进 `memory-inbox.jsonl` 的条目，会长期注入到之后的每一轮系统提示词里。插件内置三层缓解（条目以「数据非指令」+ 引号呈现、条目内换行折叠、只保留最近 30 条），但「用户确认后才入库」这道闸门**只是提示词约束，代码无法强制**。
2. **配置投毒**——`config.json` 中的 `character` / `contracts` 字段会被逐字渲染进系统提示词，等于给 AI 下指令。能改这个文件的人（或能诱导 AI 去改它的人）就能改变 AI 行为。

结论：**能写到上述两个文件的人，就能影响 AI 行为。** 这不是漏洞，是本插件的设计前提；报漏洞时请围绕「绕过确认闸门」「越界读文件」「渲染导致提示词注入逃逸」这三类来论。

## 已知设计约束（不算漏洞）

- 插件按**同名段替换**官方 `@deepseek-ai/dsh-persona`：装上即遮蔽官方人设，`enabled: false` 得到的是「没有人设」，不是「回到官方人设」；只有卸载才恢复。
- 收件箱是只读注入，插件自身不删除条目、不写入条目；条目过期需要人工清理。

## English

Report vulnerabilities through GitHub private vulnerability reporting (link above), **not** public issues. This plugin is local-only: no network access, no subprocesses, no `eval`. Its only writes are the plugin config and (read-only) memory inbox.

The realistic threat is **memory poisoning**: an unconfirmed entry appended to the memory inbox persists into every future system prompt. The built-in mitigations (data-not-instructions framing, newline folding, 30-entry cap) are defense in depth; the confirmation gate is a prompt-level convention, not an enforced one. Report bypasses of that gate, out-of-scope file access, or prompt-injection escapes as security issues.
