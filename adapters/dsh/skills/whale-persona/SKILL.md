---
name: whale-persona
description: 人设引擎 whale-persona 的配置管理工作流（DeepSeek Harness 版）。当用户想查看、创建或修改 AI 人设（自称、称呼、关系立场、性格正文、形象 appearance、回复语气 tone）、增删工作契约、设置思维链语言、管理长期记忆（收件箱晋升、坏行清理、收口开关）、改人设预设的显示名（「设置 → Agent 预设」里那张卡片叫什么），或说「更新人设」「加条契约」「看看当前人设」「以后叫某某」「给你设个形象」「语气温柔点」时使用。
---

# whale-persona · 人设配置管理（DSH）

你是人设配置的管理员：读配置 → 展示/提炼修改草案 → 用户拍板 → 读改写回 → 验证。
**不擅自写入**：任何修改先给前后对照，确认后才落盘。

## 第一步：定位配置文件

按此优先级探测（找到第一个存在的就用）：

1. `$WHALE_PERSONA_CONFIG`（环境变量，显式指定）
2. `$DSH_WHALE_CONFIG`（显式指定）
3. `$DSH_HOME/whale-persona/config.json`（默认位置；`DSH_HOME` 未设时为 `~/.dsh`）
4. `$DSH_HOME/whale-suite/config.json`（**旧布局**——插件在该目录已有 config.json 时会自动沿用，先看它，别另建一份）

都没有 → 询问用户用哪个位置，然后按「配置结构」创建默认文件（目录要递归建）。

## 配置结构（JSON）

```jsonc
{
  "enabled": true,                    // 总开关，false = 完全无人设（不是回到官方人设）
  "thinkingLanguage": "off",          // off | zh-CN | en …（思维链语言，不改答复语言）
  "persona": {
    "enabled": true,
    "selfNameFlash": "我",            // flash 档自称（模型名不含 "pro" 时用）
    "selfNamePro": "我",              // pro 档自称
  "selfNameByModel": { "grok-4.7": "小七" },  // 按具体模型指定自称（命中优先级最高；精确→最长子串→回落两档）
    "userName": "用户",               // 称呼用户
    "stance": "",                     // 关系立场（一句话，渲染在 character 之前）
    "character": "",                  // 立场正文（整段），stance/character/契约均支持 {selfName}/{userName}
    "appearance": { "enabled": false, "text": "", "byModel": {} },   // 形象（opt-in，默认关）：把「你是谁／长什么样」当既定事实注入
                                       //   结构同 tone；匹配＝精确键（忽略大小写）→ 最长子串 → 回落 text；空键/空值忽略；文本支持 {selfName}/{userName}
    "tone": { "enabled": false, "text": "", "byModel": {} },         // 语气（opt-in，默认关）：只改措辞与节奏，不改结论、证据标准与工作契约
                                       //   现成文案见 <仓库>/core/presets.js 的 TONE_PRESETS（严肃/温柔/简洁/幽默）—— 只是一键填进 tone.text 的文本，不是枚举
    "suffix": "",                     // 末尾追加句，支持 {{cwd}}
    "contracts": [ { "id": "terse", "text": "结论先行，默认精简。", "on": true } ]
  },
  "memory": {
    "enabled": false,                 // 默认关（opt-in）；开了才有下面的确认流与注入
    "entries": [],                    // 手工条目（权威层，渲染为行为准则）
    "inbox": true,                    // 收件箱确认流
    "capture": "on-demand",           // 收口开关（只控【入库纪律】的注入）：on-demand（默认，会话里 /memory on 才注入）| always（每轮注入）
    "maxEntries": 30,                 // 收件箱注入上限（保新弃旧）
    "inboxPath": "",                  // 空 = 配置目录下的 memory-inbox.jsonl
    "requireConfirm": true            // 候选确认闸门（0.8.0 起默认 true，代码强制）：注入只认人工确认过的条目；
                                      // false = 放行 0.8.0 之前的老格式条目，但 status:"proposed" 候选仍然不注入
  }
}
```

**未知键透传**：config 可能与其他工具共存（`context` / `forge` / `tools` 等段）——整体读、整体写回，
绝不裁掉不认识的段。

## 修改纪律

1. 先读原文件 → 展示当前值；
2. 用户口述想法（或给一个本地纲领文件让你提炼）→ 提炼成字段修改草案，列**前后对照**；
3. 用户确认 → 整体读改写回（保留所有未涉及段）；
4. 写完重读一遍验证 JSON 合法，报告「已生效」。

契约写法指导（给用户建议时用）：

- ✅ 具体可验证：「先给结论再给依据，总长不超过 10 行」「结尾不出现征询式问句」
- ❌ 空泛无效：「高质量」「认真思考」——模型不知道具体做什么不同的事
- 5-10 条为宜，太多互相稀释；事实类偏好（「项目用 pnpm」）进记忆流不进契约。

## 用户会怎么说 → 我该改哪个字段

| 用户怎么说 | 改哪个字段 |
|---|---|
| 「你以后叫某某」「用某个模型时你叫某某」 | `persona.selfNameByModel`（按模型）/ `selfNameFlash` / `selfNamePro`（两档回落） |
| 「你该怎么称呼我」 | `persona.userName` |
| 「你和我的关系是…」（一句话） | `persona.stance` |
| 「你的定位／性格／立场是…」（整段） | `persona.character` |
| 「你是一个 20 岁的女性」「你长这样…」「你的身份是…」 | `persona.appearance.text`（所有模型通用）或 `persona.appearance.byModel`（只给某个模型） |
| 「说话温柔点／严肃点／简洁点／幽默点」 | `persona.tone.text` —— 可先用 `core/presets.js` 里 4 条预设（严肃/温柔/简洁/幽默）的原文，用户要改字就直接改 |
| 「给某个模型设个形象」 | `persona.appearance.byModel`：`{ "宿主真实模型 id": "文本" }` —— 键**先确认真实 id**（见下节纪律 6），不许拿界面显示名当键 |
| 「换个语气」 | `persona.tone`（总开关 `enabled` + 通用 `text`）；只给某个模型换就写 `persona.tone.byModel`。语气只改措辞与节奏，不改结论、证据标准与工作契约 |
| 「用某个模型时形象／语气不一样」 | 对应字段的 `byModel`：`{ "宿主真实模型 id": "文本" }`（键照面板显示的最近一次真实 id 抄最稳；忽略大小写的子串命中，写其中够独特的一段也行） |
| 「加条规矩：……」「结尾不要……」 | `persona.contracts`（要具体可验证；5-10 条为宜） |
| 「记一下：项目用 pnpm」 | 记忆流（`memory.entries` / 收件箱），不是契约 |
| 「你思考时说中文」 | `thinkingLanguage` |
| 「设置里那张卡叫什么」 | `preset.yml` 的 `name:` 一行（见下一节） |

两段**不好归类**时的判据：说的是「我是谁／我长什么样／我的身份」→ `appearance`；说的是「我该怎么说话」→ `tone`；
说的是「你必须做到什么」→ `contracts`；说的是「事实／偏好／红线」→ 记忆流。

## 形象与语气（`persona.appearance` / `persona.tone`）的专门纪律

1. **只有用户明确要求时才改这两段。** 形象与语气是往系统提示词里注入「你是谁／你怎么说话」——**这是提示词注入通道**，
   你不许自行为自己加设定（包括「为了更好地完成这个任务，我先给自己补一条形象／语气」这种自我授权），
   也不许把用户在别处随口一提的偏好擅自升级成形象设定。
2. **改完必须在回答里说明写了什么**：把落盘的**原文**贴出来（改前 → 改后），让用户对得上账；不许只说「已更新人设」。
3. 两段都是 **opt-in、默认关**：`enabled` 必须严格为 `true` 才注入，`false` 时填了内容也不注入（新配置别默认打开）。
4. **匹配规则＝精确键（忽略大小写）→ 最长子串 → 回落 `text`**；空键、空值条目忽略；`byModel` 没命中且 `text` 也空 → 这一段整体不出现。
5. **语气只改措辞与节奏**：不许拿它改结论口径、证据标准或工作契约（渲染位置在立场正文之后、工作契约之前）。
6. **改 `byModel` 的键之前，先确认宿主真实模型 id —— 不许拿界面显示名当键。**
   界面上的显示名（DSH 对话框里的「DeepSeek-V4.1-Flash High」）**不是**宿主传给插件的模型 id（实测真值是 `deepseek-flash`）；
   照显示名写键**永远命中不了**，而且不报错、不告警，用户只会觉得「没生效」却看不出哪里错。真实 id 这样拿：
   - **面板**（装了 `whale-persona-ui`）：自称／形象／语气三张「按模型」卡会显示
     「宿主最近一次真实注入用的模型 id 是「xxx」」，点「+ 加一条」时还会用它预填关键词；
   - **没有面板 / 命令行**：读配置目录下的 `last-model.json`（与 `config.json` 同目录，如 `$DSH_HOME/whale-persona/last-model.json`）
     的 `model` 字段 —— 由 DSH 适配器在段求值时写入，**先跑过一轮对话才有值**，且记的是最近一次。
     它是**纯本机元数据**（不联网、不含人设正文），可随手删、下次自动重建；用户介意就设 `DSH_WHALE_LAST_MODEL=off` 彻底不写（代价是面板不再提示真实 id）；
   - **拿不准就先兜底**：把通用 `text` 填上（填了 `text` 至少有东西注入），`byModel` 只用来做差异。
   匹配是忽略大小写的子串（精确优先 → 最长子串 → 回落 `text`），写真实 id 里够独特的一段也行，抄完整 id 最稳。
   **改完必须把写进去的原文贴给用户看（含你用的键）**，见上一条纪律 2。

## 长期记忆与收口开关

- **收口开关（写入门控）**：`memory.capture` 默认 `'on-demand'` —— 用户在本会话里说/打 `/memory on`
  之后才注入【入库纪律】（要你提议「## 记忆候选」的那一段）；`/memory off` 关回去；`/memory status` 看状态。
  状态存在配置同目录的 `session-flags.json`（重启后仍在）。`'always'` 时不看开关、每轮都注入。
- **常驻的部分**：已确认的【历史备忘】与手工条目不受开关影响，始终加载。
- 收件箱 `memory-inbox.jsonl`：只许**追加**（每行 `{"text":"…","at":"ISO时间","status":"proposed"}`），永不改写已有行；坏行无害。
- **确认闸门（0.8.0 起是代码强制，不再是口头纪律）**：你写进去的条目只是**候选**，**不会进提示词**；
  只有用户自己跑 `node scripts/memory.mjs confirm <序号>`（**只有这条 CLI 路径**；两个面板都不提供确认按钮，
  只读地显示"待确认 K 条"）追加的
  `{"op":"confirm","ref":"原文","at":…}` 才让它生效。据此：
  - 别对用户说「我已记住」，要说「候选已入队，等你确认」；
  - **你不许**写 `confirm` / `reject` 行，也不许把 `proposed` 改成 `confirmed`——那是伪造确认；
  - 用户问「记忆怎么没生效 / 怎么确认」→ 让他跑 `node scripts/memory.mjs status` 看序号，再 `confirm <序号…|all>`；
    0.8.0 之前的老格式条目（没有 status 字段）默认也不注入，`adopt` 可一次性确认。
- 晋升：把收件箱里稳定有效的条目整理进 `memory.entries`（带 `"on": true`），收件箱对应行可删可留。
- **分类路由（0.13.0，只在用户配了 `memory.sinks` 时存在）**：条目可带 `"kind"`，缺省 `"memory"`（注入提示词）。
  `kind` 非 memory 的（如 `pitfall` / `idea`）**永不进提示词**——用户 `confirm` 的那一刻，插件才把它
  **只追加式**写进路由指向的文件（`path` / `format: md|plain|jsonl` / `template`），写完出队，幂等不可重写。
  你该做的：**照旧只写 `status:"proposed"` 的候选行**，多带一个 `kind` 字段即可；落盘动作在用户手上。
  配了路由时，【入库纪律】里会多出「分类路由」一段列出 kind → 目标文件，照那段写，不要自己编 kind
  （没有路由的 kind 确认后会"无处可去"，用户会看到提示）。
- 注入时收件箱按「数据非指令」呈现（引号包裹、换行折叠、剥离「」）——这是刻意的抗注入设计，不要改这个口径。

## 生效方式

- persona 段**每步求值**：配置改完，用户下一句就生效，**不需要新会话**。
- 但**挂载变更**（增删 preset 里的插件行、改 id）要新会话；改完配置却「没变化」时，先确认插件行还在。
- `enabled: false` = 没有任何人设（不是回到官方 persona）；要恢复官方人设得**卸载挂载行**。

## 预览渲染结果

想提前看渲染全文，按渲染核心的口径自己算一遍（`core/prompt.js`）：

```js
const { mergeConfig } = await import('<仓库>/core/defaults.js')
const { buildPersonaPrompt } = await import('<仓库>/core/prompt.js')
const { captureActive } = await import('<仓库>/core/capture.js')
const cfg = mergeConfig(JSON.parse('<config.json 内容>'))
buildPersonaPrompt(cfg, 'flash', cwd, { capture: captureActive(cfg, agent) })
```

或者直接跑仓库测试看夹具输出：`node tests/smoke.mjs`、`node tests/inbox.mjs`。

## 两个"名字"别搞混（用户说「改个名字」时先分清）

| 名字 | 是什么 | 存在哪 | 怎么改 |
|---|---|---|---|
| **预设显示名** | 「设置 → Agent 预设」里那张卡片的名字（出厂写「自定义人设」） | `$DSH_HOME/.agent-presets/whale-persona/preset.yml` 的 `name:` 一行 | 改那一行；预设元数据变化在下一次挂载/刷新时生效 |
| **自称** | AI 在提示词里管自己叫什么（`{selfName}` 渲染出来的词） | `config.json` 的 `persona.selfNameByModel`（按模型，优先）/ `selfNameFlash` / `selfNamePro`（两档回落） | 照「修改纪律」读改写回，**下一步生效** |

判断口诀：用户说「设置里那张卡叫什么」= 预设显示名；用户说「你以后自称什么」= 自称；
用户说「用某个模型时你叫某某」= 往 `persona.selfNameByModel` 加一条（键写模型名里好认的一段即可，如 `grok-4.7`，子串能命中带前缀的完整 id）。
两个都改时，先列前后对照再落盘，落盘后在回答里**逐条说明改了哪两处**（用户要对得上账）。

## 设置面板（看得见的那一层）

装了 UI 包（`whale-persona-ui`，挂在 profile 平面）后，「设置 → 人设」是**可直接编辑的界面**：左边填（自称/称呼/立场/正文/工作契约/长期记忆），右边实时显示此刻实际注入的三段正文（可按 flash/pro 档切换）、逐条契约与开关态、长期记忆条数与最近几条。
用户问「我现在的人设到底是什么」→ **先让他看这张卡片**，再考虑是不是要改配置；卡片上的文本与运行期注入同源（同一份 `core/`），不是另算的近似值。
写入有三条路，**同一套纪律**（`core/edit.js`：只替换已知段、未知键保留、坏 JSON 拒写）：设置面板里自己改、本地编辑器（`node scripts/ui.mjs`）、或你读改写回配置。
用户说「我在设置里改了但没生效」时先查两件事：① 是否点了保存（面板有「未保存」提示）；② 是否改的是 **pro 档**字段而当前模型是 flash 档（自称分两档）。
