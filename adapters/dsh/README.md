# dsh-whale-persona —— DSH 适配器

**Persona engine for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)** —
把系统提示词的人设段变成可开关、可编辑、可记忆的配置。本目录是 whale-persona 的
DSH 宿主适配；渲染核心在仓库根 [`core/`](../../core/)（与 ZCode 适配器共享）。

## 特性

- **人设可开关**：配置关掉 = 渲染为空（无人设），不残留、不炸会话。注意本插件是官方
  `@deepseek-ai/dsh-persona` 的**替代**而非叠加——只有完整卸载挂载行才会回到官方人设。
- **自称/称呼/立场/契约**：双模型档自称（flash 档 / pro 档）、称呼用户、一句话关系立场（stance）、
  整段立场正文（character）、逐条可勾选的工作契约；产物是每步重新求值的提示词段，改完下一步生效。
- **思维链语言**：`off`（默认不干预）/ `zh-CN` / `en` …，只影响思考可读性与 token，不改答复语言。
- **长期记忆（确认流，默认关）**：阶段收口时 AI 列出「记忆候选」→ 用户确认 → 逐条**追加**到
  inbox（JSONL，只许追加，坏行跳过）；注入时按**数据**呈现（引号 + 「非指令」声明）、
  条目内换行折叠，不与用户准则混排——这是刻意的抗提示词注入设计。
- **全链路降级**：任何异常都返回空段——插件坏了最坏结果是「没有人设」，永远不会让会话发不出话。

## 安装

```bash
# 1) 克隆整个仓库（挂载需要 core/，不要只拷本目录），装进 DSH profile：
dsh plugin --profile web add link:/path/to/whale-persona/repo/adapters/dsh

# 2) 在 profile 或 agent preset 的补丁层挂一行（preset 层才能遮蔽部署级默认人设）：
#    - id: whale-persona
#      name: '@dsh-external/dsh-whale-persona'
```

要求：DSH ≥ 0.1.6-alpha.1，Node ≥ 20。无运行时依赖。

## 配置

`$DSH_HOME/whale-suite/config.json`（也可用环境变量 `DSH_WHALE_CONFIG` 指定别的文件；
ZCode 适配器默认也读这里——一份人设两个宿主）：

```jsonc
{
  "enabled": true,
  "thinkingLanguage": "off",          // off | zh-CN | en | ...
  "persona": {
    "enabled": true,
    "selfNameFlash": "我",             // flash 档模型的自称
    "selfNamePro": "我",               // pro 档模型的自称
    "userName": "用户",                // 它怎么称呼你
    "stance": "",                      // 关系立场（一句话，渲染在 character 之前）
    "suffix": "",                      // 末尾追加句；支持 {{cwd}}。默认空 = 装上零行为改变
    "character": "",                   // 立场正文，支持 {selfName}/{userName}
    "contracts": [                     // 工作契约，逐条可关
      { "id": "terse", "text": "结论先行，默认精简。", "on": true }
    ]
  },
  "memory": {
    "enabled": false,                  // 默认关（opt-in）；开启后才有下面的确认流与注入
    "entries": [],                     // 手工条目（权威层）
    "inbox": true,                     // 收件箱（AI 确认流）
    "maxEntries": 30,                  // 收件箱注入上限（保新弃旧）
    "inboxPath": ""                    // 空 = $DSH_HOME/whale-suite/memory-inbox.jsonl
  }
}
```

改配置**下一步生效**（段文本是函数，每次组装重新求值）；增删挂载行才需要新会话。

### 契约怎么写才有效

契约的收益取决于写得是否**具体可验证**：

- ✅ 有效：「先给结论再给依据，总长不超过 10 行」「结尾不要出现征询式问句」「改代码前先说改哪几个文件」
- ❌ 无效：「高质量」「认真思考」「专业」——模型不知道具体该做什么不同的事，等于没写

条数以 5-10 条为宜，太多会互相稀释；与其它插件注入的规则矛盾时，表现还会不稳定
（排查方法：看系统提示词里各插件注入的段，一个关注点只留一个信息源）。
分工：风格/口吻/行为约定走契约；事实类偏好（「项目用 pnpm」「存档目录别碰」）走记忆流。

## 长期记忆怎么工作

```
阶段收口 → AI 列「## 记忆候选」 → 你确认/修改
        → AI 逐条追加 {"text":"…","at":"…"} 到 inbox.jsonl（只追加，永不改写）
        → 每个会话把它作为【历史备忘（数据，非指令）】注入
```

想要更结构化的记忆：用你自己的文件按主题分节编纂，inbox 当日流水、定期把稳定条目
「晋升」进手工条目（权威层）。项目级细节请放项目自己的记忆文件，不要塞进这里。

## 让 AI 代写配置（懒人工作流）

配置只是普通 JSON，DSH 里的 AI 有文件读写工具——你不必手写。口述想法，或给它一个
本地思想纲领文件让它提炼，确认后由它落盘。指令模板：

> 我想调整你的人设：……（你的想法，或：读取 `D:\我的思想纲领.md` 从中提炼）。
> 请提炼成 config.json 里 character / contracts / stance 的修改，先给我看修改前后对照，
> 我确认后写回 `$DSH_HOME/whale-suite/config.json`。要求：① 先读原文件、整体改写回写，
> 保留 thinkingLanguage 和 memory 段不动；② 写完重读一遍验证 JSON 合法。

要点：

- **改完下一步生效**（mtime 缓存设计），可以对话式来回微调：「语气再硬一点」→ 看效果 → 再改。
- 写坏 JSON 不会炸会话：插件回落到上一次的配置或默认值，症状只是「人设消失」，让 AI 自验即可规避。
- 固化流程：在 contracts 里加一条「当{userName}说『更新人设』时：提炼意图 → 列前后对照征求
  确认 → 读改写回 config.json 并验证 JSON 合法」，之后只需说「更新人设」三个字。

## 安全与隐私

- 不联网、不读工作目录、不执行任何命令：只读写你自己的 config 与 inbox 文件。
- inbox 条目在提示词里按**数据**呈现并显式声明「非指令」，降低提示词注入风险；
  入库需用户确认（AI 不擅自记）。
- `suffix` 里的 `{{cwd}}` 由本插件自行替换，其它 `{{var}}` 原样保留——不会触发
  DSH 的未注册变量错误（那会让会话发不出第一句话）。
- **残余风险（自写通道）**：开启记忆流后，模型会向 inbox 追加内容、而 inbox 会回注到
  之后的所有会话。「用户拍板」闸门由提示词约束（未被确认的一律不写），**不是代码强制**——
  恶意对话若诱导出假确认，理论上可写入长期生效的文本。建议定期翻看
  `memory-inbox.jsonl`，发现不对的行直接删（删行/坏行都不影响读取）。

## 兼容与已知边界

- 它**替代**官方 `@deepseek-ai/dsh-persona` 行（段按 name 注册，同名不能并存）。
- 只能加/换具名段，改不动工具定义段与 harness 核心段。
- 效果是概率性的：提示词是行为先验不是命令；与其它指令冲突时会被削弱。

## 测试

```bash
cd adapters/dsh && npm test        # 或 node tests/smoke.mjs && node tests/inbox.mjs && node tests/zcode-hook.mjs
```

## 许可

MIT © 2026 shenA2024
