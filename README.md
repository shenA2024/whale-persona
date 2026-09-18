# whale-persona —— 多宿主人设引擎

把 AI 编码助手的「人设」变成**可开关、可编辑、可记忆**的配置产物：自称（按模型分档）、
称呼、关系立场、性格正文、逐条可勾选的工作契约、思维链语言、确认闸门的长期记忆。
一份 `config.json` + 一个收件箱文件，**多个宿主共用同一套人设与记忆**。

> English summary: a persona engine for AI coding harnesses. One shared JSON config drives
> self-name (tiered by model), user address, stance, character, per-contract toggles,
> thinking-chain language, and a confirmation-gated long-term memory inbox. Dual adapters:
> DeepSeek Harness (system-prompt sections) and ZCode (plugin hook + skill).

## 你在哪个宿主里？（给 AI 的安装引导）

如果你是 AI 助手、被用户要求安装本工具，按宿主自行选择：

- **DeepSeek Harness（DSH）**：客户端是 DSH，插件挂载在 profile / agent preset 里，
  系统提示词由具名段组装 → 用 [`adapters/dsh/`](adapters/dsh/README.md)。
- **ZCode**（含其他兼容 ZCode 插件体系的环境）：客户端是 ZCode，有 Settings → Plugin
  Management、skills、hooks → 用 [`adapters/zcode/`](adapters/zcode/README.md)。
- **两者都在用**：两个适配器都装。它们共享同一份配置与收件箱（DSH 默认位置
  `$DSH_HOME/whale-suite/`），人设改一次、两边同步生效。

## 仓库结构

```
core/            渲染核心（宿主无关的唯一源）：默认值 / 渲染 / 提示词构建 / 收件箱读写
adapters/dsh/    DeepSeek Harness 插件：注册 persona-prefix/suffix/thinking-language 三段
adapters/zcode/  ZCode 插件：UserPromptSubmit hook 每轮注入 + whale-persona 管理技能
scripts/         sync-core.mjs：core → zcode vendor 副本同步（改 core 后必跑）
tests/           三套测试：DSH 冒烟 / 记忆收件箱 / ZCode hook
```

## 两个适配器的能力对照

| 能力 | DSH 版 | ZCode 版 |
|---|---|---|
| 注入机制 | 系统提示词具名段（order 0/20/10200） | `UserPromptSubmit` hook → `additionalContext` |
| 改配置生效 | 下一步 | 下一步 |
| 按模型分档自称 | ✅（段函数按 agent 模型现场选档） | ✅（hook 按事件输入的模型选档） |
| 思维链语言 | ✅ 专用段 | ✅ |
| 记忆确认流 | ✅（收件箱按数据注入） | ✅（同一套收件箱与纪律文案） |
| 无 hook 兜底 | —（挂载即用） | `--preview` 导出静态文本贴 AGENTS.md，新会话生效 |
| 关闭方式 | config `enabled:false` = 无人设；卸载挂载行回官方 persona | 禁用插件即停；纯默认配置渲染为空（装上不改行为） |

共享：同一份 config schema、同一套渲染文案、同一个收件箱文件——两个宿主看到的是
同一个「人」。差异只在注入通道。

## 快速开始（人设怎么写）

配置结构与「契约怎么写才有效」「让 AI 代写配置」的完整说明在
[`adapters/dsh/README.md`](adapters/dsh/README.md)（两宿主通用，ZCode 用户同样适用，
配置文件定位链见 [`adapters/zcode/README.md`](adapters/zcode/README.md)）。

## 开发

```bash
node scripts/sync-core.mjs     # 改 core/ 后同步 vendor 副本（测试 Z7 会校验）
npm test                       # 在 adapters/dsh/ 下跑全部三套测试
```

## 记忆流（2026-09-18 升级：合并式候选 + tag 相关性）

- 候选分三类：`[新增]` 落事实行 `{"text","at","tag"?}`；`[更新]` 落 `{"op":"supersede","ref":"旧原文","text":"新原文"}`；`[删去]` 落 `{"op":"drop","ref":"旧原文"}`。读取时按行序**重放**出注入视图——物理只追加（坏一行不牵连整箱），逻辑可更新可删去，矛盾旧事实被替代而非无限堆积。
- 注入按 cwd/tag 相关性选择：当前项目目录命中的条目优先、其次全局（无 tag）、再其他项目，超出 `memory.maxEntries` 才组内保新弃旧。DSH 从 agent session 取 cwd，ZCode 从 hook 输入取，两宿主同链。
- 首次运行落盘只写**骨架**（persona 段），不写死 memory 段——memory 默认关（opt-in），谁读谁按默认补。

## 安全与隐私（两宿主一致）

- core 不联网、不执行命令、不读工作目录：只读写自己的 config 与 inbox 文件；
- 收件箱条目按**数据**呈现（引号 + 「非指令」声明 + 换行折叠 + 剥离「」），降低提示词注入风险；
- 一切异常降级为空输出——最坏结果是「没有人设」，永远不炸会话；
- 残余风险：「用户确认后才入库」由提示词约束而非代码强制，建议定期翻看收件箱删不对的行。

## 许可

MIT © 2026 shenA2024
