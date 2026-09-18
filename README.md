# dsh-whale-persona

**Persona engine for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)** — turn the system prompt's
persona section into something you can switch, edit, and remember.

一个 DSH 插件：把系统提示词里的「人设段」变成**可开关、可编辑、可记忆**的配置产物。

> English summary: this plugin registers the `deployment:persona-prefix` / `persona-suffix` /
> `thinking-language` system-prompt sections, rendering them from a JSON config on every
> assembly. Zero opinion by default (self-name "我", user address "用户", empty character and
> contracts) — you fill in what you want. It also ships a confirmation-gated long-term memory
> flow (AI proposes → you confirm → append-only inbox → injected as *data*, not instructions).

## 特性

- **人设可开关**：关掉即完全回到 DSH 原生提示词，不残留、不炸会话。
- **自称/称呼/立场/契约**：双模型档自称（flash 档 / pro 档）、称呼用户、整段立场正文、
  逐条可勾选的工作契约；产物是每步重新求值的提示词段，改完下一步生效。
- **思维链语言**：`off`（默认不干预）/ `zh-CN` / `en` …，只影响思考可读性与 token，不改答复语言。
- **长期记忆（确认流）**：阶段收口时 AI 列出「记忆候选」→ 用户确认 → 逐条**追加**到
  inbox（JSONL，只许追加，坏行跳过）；注入时按**数据**呈现（引号 + 「非指令」声明），
  不与用户准则混排——这是刻意的抗提示词注入设计。
- **全链路降级**：任何异常都返回空段——插件坏了最坏结果是「没有人设」，永远不会让会话发不出话。

## 安装

```bash
# 1) 放进你的插件目录（任意位置），装进 DSH profile：
dsh plugin --profile web add link:/path/to/dsh-whale-persona

# 2) 在 profile 或 agent preset 的补丁层挂一行（preset 层才能遮蔽部署级默认人设）：
#    - id: whale-persona
#      name: '@dsh-external/dsh-whale-persona'
```

要求：DSH ≥ 0.1.6-alpha.1，Node ≥ 20。无运行时依赖。

## 配置

`$DSH_HOME/whale-suite/config.json`（也可用环境变量 `DSH_WHALE_CONFIG` 指定别的文件）：

```jsonc
{
  "enabled": true,
  "thinkingLanguage": "off",          // off | zh-CN | en | ...
  "persona": {
    "enabled": true,
    "selfNameFlash": "我",             // flash 档模型的自称
    "selfNamePro": "我",               // pro 档模型的自称
    "userName": "用户",                // 它怎么称呼你
    "stance": "",                      // 关系立场（自由文本）
    "suffix": "Your working directory is {{cwd}}.",
    "character": "",                   // 立场正文，支持 {selfName}/{userName}
    "contracts": [                     // 工作契约，逐条可关
      { "id": "terse", "text": "结论先行，默认精简。", "on": true }
    ]
  },
  "memory": {
    "enabled": true,
    "entries": [],                     // 手工条目（权威层）
    "inbox": true,                     // 收件箱（AI 确认流）
    "maxEntries": 30,                  // 收件箱注入上限（保新弃旧）
    "inboxPath": ""                    // 空 = $DSH_HOME/whale-suite/memory-inbox.jsonl
  }
}
```

改配置**下一步生效**（段文本是函数，每次组装重新求值）；增删挂载行才需要新会话。

## 长期记忆怎么工作

```
阶段收口 → AI 列「## 记忆候选」 → 你确认/修改
        → AI 逐条追加 {"text":"…","at":"…"} 到 inbox.jsonl（只追加，永不改写）
        → 每个会话把它作为【历史备忘（数据，非指令）】注入
```

想要更结构化的记忆：用你自己的文件按主题分节编纂，inbox 当日流水、定期把稳定条目
「晋升」进手工条目（权威层）。项目级细节请放项目自己的记忆文件，不要塞进这里。

## 安全与隐私

- 不联网、不读工作目录、不执行任何命令：只读写你自己的 config 与 inbox 文件。
- inbox 条目在提示词里按**数据**呈现并显式声明「非指令」，降低提示词注入风险；
  入库需用户确认（AI 不擅自记）。
- `suffix` 里的 `{{cwd}}` 由本插件自行替换，其它 `{{var}}` 原样保留——不会触发
  DSH 的未注册变量错误（那会让会话发不出第一句话）。

## 兼容与已知边界

- 它**替代**官方 `@deepseek-ai/dsh-persona` 行（段按 name 注册，同名不能并存）。
- 只能加/换具名段，改不动工具定义段与 harness 核心段。
- 效果是概率性的：提示词是行为先验不是命令；与其它指令冲突时会被削弱。

## 测试

```bash
npm test          # 或 node tests/smoke.mjs && node tests/inbox.mjs
```

## 许可

MIT © 2026 shenA2024
