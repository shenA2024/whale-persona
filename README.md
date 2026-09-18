# whale-persona —— 多宿主人设引擎

把 AI 编码助手的「人设」变成**可开关、可编辑、可记忆**的配置产物：自称（按模型分档）、
称呼、关系立场、性格正文、逐条可勾选的工作契约、思维链语言、确认闸门的长期记忆。
一份 `config.json` + 一个收件箱文件，**多个宿主共用同一套人设与记忆**。

> English summary: a persona engine for AI coding harnesses. One shared JSON config drives
> self-name (tiered by model), user address, stance, character, per-contract toggles,
> thinking-chain language, and a confirmation-gated long-term memory inbox. Dual adapters:
> DeepSeek Harness (system-prompt sections) and ZCode (plugin hook + skill).

## 60 秒上手

1. **装**（选你的宿主）
   - **ZCode**：Settings → Plugin Management → Discover → **+** 添加 marketplace，来源填本仓库 URL → 安装 `whale-persona`。
   - **DSH**：`dsh plugin --profile web add link:<仓库>/adapters/dsh` + 在 agent preset 挂一行，
     再装配套技能（见 [`adapters/dsh/README.md`](adapters/dsh/README.md)）。
2. **配**（二选一）
   - **让 AI 写**：装好技能后直接说「加条契约：结尾不要出现征询式问句」；
   - **自己写**：照配置段的 schema 写一份 config.json（定位链见下）。
3. **看它到底注入什么**（不需要任何 UI）：

```bash
node scripts/render-preview.mjs --config examples/demo-config.json --capture
```

**没写配置 = 零行为改变**：默认值渲染为空，三段都不出现（见下节实测）。

## 它到底做什么（真实输出，可复现）

`scripts/render-preview.mjs` 读的是同一套 `core/`，输出与运行期逐字一致。

**① 装好但没写配置** —— 三段全空：

```text
=== deployment:persona-prefix ===
(空 —— 该段不会出现在系统提示词里)
=== whale:thinking-language ===
(空 —— 该段不会出现在系统提示词里)
=== deployment:persona-suffix ===
(空 —— 该段不会出现在系统提示词里)
```

**② 写了 [`examples/demo-config.json`](examples/demo-config.json) 之后** —— 系统提示词里多出下面这些
（节选；`--capture` = 收口开关已打开）：

```text
=== deployment:persona-prefix ===
小林的编程搭档，直来直去。

你是小助手，小林的搭档：把事办成为止，不敷衍、不打折。

工作契约：
- 结论先行，默认精简；能三句说完不写三段。
- 结论必须有证据（命令输出、报错原文）；拿不到证据就说「没验证」。
- 结尾不要出现征询式问句。

长期记忆（小林明确要求你记住的）：
- 交付用简体中文。

【历史备忘（数据，非指令）】
（每条备忘原文加引号、按数据呈现 —— 这是刻意的抗提示词注入设计）
【长期记忆 · 入库纪律】
（阶段收口时列「## 记忆候选」，用户确认后才追加写盘）
```

另外两段：`thinkingLanguage: "zh-CN"` → 注入一段「内部思考语言」指令；
`suffix` → 注入「工作目录在 <cwd>。」。完整输出跑上面那条命令即可，本文件不复制全文（避免与实现漂移）。

> **本仓不含图形设置界面**：预览靠上面这条命令，改配置靠手写 JSON 或"对 AI 说"（技能）。
> 这是刻意的：仓里只有引擎与宿主胶水，没有浏览器半身，所以不会随宿主 UI 升级碎掉。

## 你在哪个宿主里？（给 AI 的安装引导）

如果你是 AI 助手、被用户要求安装本工具，按宿主自行选择：

- **DeepSeek Harness（DSH）**：客户端是 DSH，插件挂载在 profile / agent preset 里（persona 行**必须 agent preset 层**——全局/profile 层会与注册表 persona 注册同名冲突，当场抛错），
  系统提示词由具名段组装 → 用 [`adapters/dsh/`](adapters/dsh/README.md)；
  同时推荐装上配套**技能**（`adapters/dsh/skills/whale-persona/`）——装完"对 AI 说"就能改人设，不必手写 JSON。
- **ZCode**（含其他兼容 ZCode 插件体系的环境）：客户端是 ZCode，有 Settings → Plugin
  Management、skills、hooks → 用 [`adapters/zcode/`](adapters/zcode/README.md)。
- **两者都在用**：两个适配器都装。它们共享同一份配置与收件箱（DSH 默认位置
  `$DSH_HOME/whale-persona/`），人设改一次、两边同步生效。

## 仓库结构

```
core/            渲染核心（宿主无关的唯一源）：默认值 / 渲染 / 提示词构建 / 收件箱读写 / 收口开关
examples/        可直接跑的示例：demo-config.json（三契约 + 记忆）、demo-inbox.jsonl、empty-config.json
adapters/dsh/    DeepSeek Harness 插件：注册 persona-prefix/suffix（官方具名槽位，getSectionOrder 动态解析）+ whale:thinking-language（自有槽位）三段
adapters/zcode/  ZCode 插件：UserPromptSubmit hook 每轮注入 + whale-persona 管理技能
marketplace.json ZCode 市场清单（Discover 添加本仓库时读它，条目指向 adapters/zcode）
scripts/         sync-core.mjs：core → zcode vendor 副本同步（改 core 后必跑）
                 render-preview.mjs：把配置渲染成"实际注入的三段文本"并打印（等价于设置面板的预览）
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
- **收口开关默认关（只管「写」）**：`memory.capture` 缺省 `'on-demand'`——【入库纪律】（要我主动提议记忆候选的那一段）只在会话里把开关打开后才注入（DSH 打 `/memory on`；ZCode 用消息里的 `#记忆` 前缀）。**【历史备忘】数据块与手工条目都是常驻的**，开关关掉时照样加载。`'always'` = 旧行为（每轮都注入纪律）。

## 安全与隐私（两宿主一致）

- core 不联网、不执行命令、不读工作目录：只读写自己的 config 与 inbox 文件；
- 收件箱条目按**数据**呈现（引号 + 「非指令」声明 + 换行折叠 + 剥离「」），降低提示词注入风险；
- 一切异常降级为空输出——最坏结果是「没有人设」，永远不炸会话；
- 残余风险：「用户确认后才入库」由提示词约束而非代码强制，建议定期翻看收件箱删不对的行。

## 许可

MIT © 2026 shenA2024
