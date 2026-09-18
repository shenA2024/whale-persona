---
name: whale-persona
description: 人设引擎 whale-persona 的配置管理工作流。当用户想查看、创建或修改 AI 人设（自称、称呼、关系立场、性格正文、形象 appearance、回复语气 tone）、增删工作契约、设置思维链语言、管理长期记忆（收件箱晋升、坏行清理），或说「更新人设」「加条契约」「看看当前人设」「给你设个形象」「语气温柔点」时使用。也用于把渲染产物导出为静态文本（无 hook 兜底模式）。
---

# whale-persona · 人设配置管理

你是人设配置的管理员：读配置 → 展示/提炼修改草案 → 用户拍板 → 读改写回 → 验证。
**不擅自写入**：任何修改先给前后对照，确认后才落盘。

## 第一步：定位配置文件

按此优先级探测（找到第一个存在的就用）：

1. `$WHALE_PERSONA_CONFIG`（环境变量，显式指定）
2. `$DSH_WHALE_CONFIG`（DSH 用户的显式指定）
3. `$DSH_HOME/whale-persona/config.json`（默认位置；`DSH_HOME` 未设时为 `~/.dsh`。旧布局 `$DSH_HOME/whale-suite/config.json` 存在时自动沿用）
4. `~/.whale-persona/config.json`（纯 ZCode 用户）

都没有 → 询问用户用哪个位置，然后按「配置结构」创建默认文件（目录要递归建）。

## 配置结构（JSON，字段与 DSH 版完全一致）

```jsonc
{
  "enabled": true,                    // 总开关，false = 完全无人设
  "thinkingLanguage": "off",          // off | zh-CN | en …（思维链语言，不改答复语言）
  "persona": {
    "enabled": true,
    "selfNameFlash": "我",            // flash 档自称（模型名不含 "pro" 时用）
    "selfNamePro": "我",              // pro 档自称
"selfNameByModel": {},           // 按具体模型指定自称（命中优先级最高；精确→最长子串→回落两档）
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
    "enabled": false,                 // 默认关（opt-in）
    "entries": [],                    // 手工条目（权威层，渲染为行为准则）
    "inbox": true,                    // 收件箱确认流
    "capture": "on-demand",           // 收口开关（只控【入库纪律】的注入）：on-demand（默认，消息带 #记忆 前缀那轮才注入）| always（每轮注入）；【历史备忘】常驻
    "maxEntries": 30,                 // 收件箱注入上限（保新弃旧）
    "inboxPath": "",                  // 空 = 配置目录下的 memory-inbox.jsonl；纯 ZCode 用户建议显式指定
    "requireConfirm": true            // 候选确认闸门（0.8.0 起默认 true，代码强制）：注入只认人工确认过的条目
  }
}
```

**未知键透传**：config 可能与其他工具共存（context/forge/tools 等段）——整体读、整体写回，绝不裁掉不认识的段。

## 修改纪律

1. 先读原文件 → 展示当前值；
2. 用户口述想法（或给一个本地纲领文件让你提炼）→ 提炼成字段修改草案，列**前后对照**；
3. 用户确认 → 整体读改写回（保留所有未涉及段）；
4. 写完重读一遍验证 JSON 合法，报告「已生效」。

契约写法指导（给用户建议时用）：
- ✅ 具体可验证：「先给结论再给依据，总长不超过 10 行」「结尾不出现征询式问句」
- ❌ 空泛无效：「高质量」「认真思考」——模型不知道具体做什么不同的事
- 5-10 条为宜，太多互相稀释；事实类偏好（「项目用 pnpm」）进记忆流不进契约。

## 生效方式与预览

- **hook 模式**（已装本插件的正常路径）：配置改完，用户下一步输入即注入新人设——每轮动态渲染。
  预览渲染全文：`node <插件目录>/hooks/render.mjs --preview`
- **静态兜底**（未装插件/不想跑 hook）：用 --preview 导出渲染文本，让用户贴进 `~/.zcode/AGENTS.md`（用户级，全部工作区生效）或 `<repo>/AGENTS.md`（项目级），新会话生效。
  注意：静态模式下记忆收件箱不会自动注入（无每轮渲染），定期重新导出。

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
| 「用某个模型时形象／语气不一样」 | 对应字段的 `byModel`：`{ "宿主真实模型 id": "文本" }`（注意：`--preview` 不带模型，预览里看不出 `byModel` 有没有命中，别拿它当验收） |
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
6. **改 `byModel` 的键之前，先确认真实模型 id —— 不许拿界面显示名当键。**
   界面显示名（如 DSH 里的「DeepSeek-V4.1-Flash High」）**不是**宿主传给插件的模型 id（DSH 实测真值是 `deepseek-flash`）；
   照显示名写键**永远命中不了**，不报错、不告警，用户只会觉得「没生效」。ZCode 侧的取法：
   - hook 读的是事件 JSON 里的 `model` 字段（`hooks/render.mjs` 的 `input.model`），插件默认不打印；
     确需要确切值时，临时在 hook 里加一行把事件落盘（`appendFileSync('<工作目录>/zcode-hook-event.jsonl', JSON.stringify(input) + '\n')`），跑一轮读出来，看完删掉；
   - **`last-model.json` 是 DSH 侧的能力**：ZCode 的 hook 不写它、也没有设置面板可看，别拿 `$DSH_HOME/whale-persona/last-model.json` 当 ZCode 的依据；
   - **拿不准就先兜底**：把通用 `text` 填上（填了 `text` 至少有东西注入），`byModel` 只用来做差异。
   匹配是忽略大小写的子串（精确优先 → 最长子串 → 回落 `text`），写真实 id 里够独特的一段也行，抄完整 id 最稳。
   **改完必须把写进去的原文贴给用户看（含你用的键）**，见上一条纪律 2。

## 长期记忆维护

- 收件箱 `memory-inbox.jsonl`：AI 只追加（每行 `{"text":"…","at":"ISO时间","status":"proposed"}`），不改写已有行；坏行无害可随时手删。
- **确认闸门（0.8.0 起代码强制）**：`status:"proposed"` 的候选**不会注入**；只有用户跑
  `node scripts/memory.mjs confirm <序号>`（或设置面板确认）追加的 `{"op":"confirm",…}` 才让它生效。
  AI 不许写 confirm/reject 行、不许把 proposed 改成 confirmed（伪造确认）。老格式条目用 `adopt` 一次性确认。
- 晋升：把收件箱里稳定有效的条目，整理进 `memory.entries`（带 `"on": true`），收件箱对应行可删可留。
- 注入时收件箱按「数据非指令」呈现（引号包裹、换行折叠）——这是刻意的抗注入设计，不要改这个口径。
