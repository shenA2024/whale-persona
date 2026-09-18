# whale-persona —— 多宿主人设引擎

把 AI 编码助手的**人设**变成一份可开关、可编辑、可记忆的配置：自称（按模型分档）、对用户的称呼、
关系立场、性格正文、逐条可勾选的工作契约、思维链语言，以及**带代码级确认闸门**的长期记忆。
一份 `config.json` + 一个收件箱文件，**DSH 与 ZCode 两个宿主共用同一个人设**。
> **维护状态（2026-09-19）**：主宿主是 **DeepSeek Harness**；**ZCode 适配器已冻结**（不再单独开发 / 真机回归，
> 但 core 的新能力仍随 `scripts/sync-core.mjs` 同步过去，照旧可用）。

MIT · 纯 ESM · 零运行时依赖 · 不联网 · 异常一律降级为空（最坏是"没有人设"，不炸会话）。

**English**: a persona engine for AI coding harnesses. One shared JSON config drives self-name
(tiered by model), user address, stance, character, per-contract toggles, thinking-chain language,
appearance (who you are, injected as a given fact) and reply tone (wording only — it never changes
conclusions, evidence standards or the work contract), both opt-in and off by default and both
overridable per model, and a long-term memory inbox whose entries only take effect after an explicit human `confirm` line
(enforced in code, not just in the prompt). Dual adapters: DeepSeek Harness (system-prompt sections
+ settings panel) and ZCode (plugin hook + skill). MIT, no runtime dependencies, never touches the
network; any error degrades to an empty section.

---

## 它给你什么

| 能力 | 说明 |
|---|---|
| 自称 / 称呼 | `{selfName}` `{userName}` 占位符；自称可按**具体模型**指定（`selfNameByModel`），未命中回落 flash / pro 两档 |
| 立场与性格 | `stance`（一句话）与 `character`（整段正文），渲染在提示词最前面 |
| 形象（`appearance`） | opt-in、**默认关**：把「你是谁／长什么样」当**既定事实**注入（`text` 通用 + `byModel` 按模型覆盖，键写**宿主真实模型 id**）；渲染在立场正文之后、工作契约之前 |
| 回复语气（`tone`） | opt-in、**默认关**：**只改措辞与节奏**，不改结论、证据标准与工作契约；结构与形象相同，现成文案见 `core/presets.js` |
| 工作契约 | 逐条可勾选，`on:false` 即停用；写得具体可验证才有效 |
| 思维链语言 | 只改**思考**语言，不改答复语言（`off` / `zh-CN` / `en` …） |
| 长期记忆 | 手工条目（权威层）+ 收件箱（AI 提议 → **人确认** → 只追加式入库） |
| 两个编辑入口 | DSH「设置 → 人设」可编辑面板 + 本仓自带本地编辑器页；**同一套读写纪律** |
| 零行为改变 | 不写配置 = 三段全空，装上不改变任何行为（有单测钉住） |
| 默认安全 | 不联网、不执行命令、不读你的工作目录；只读写自己的 config 与收件箱 |

## 60 秒上手

**① 装（DSH）** —— 一条命令：装插件 + 建预设 + 设默认 + 拷技能 + 自检

```bash
git clone https://github.com/shenA2024/whale-persona.git
cd whale-persona
node scripts/install-dsh.mjs --dry-run   # 先看它要做什么
node scripts/install-dsh.mjs             # 真装
```

要求：**Node ≥ 20**、**DSH ≥ 0.1.6-alpha.1**，装完**重启 DSH**。装完你会看到两处新东西：

- **设置 → Agent 预设**：多出一张「**自定义人设**」卡片（已是「新任务默认」）；
- **设置 → 人设**：左边填（自称/称呼/立场/正文/工作契约/长期记忆），右边**实时显示此刻实际注入的三段文本**，保存即生效。

**② 装（ZCode · 已冻结）**：Settings → Plugin Management → Discover → **+** 添加 marketplace，来源填本仓库 URL → 安装 `whale-persona`。
（ZCode 适配器自 2026-09-19 起进入冻结维护：仍可安装，但不再单独开发、出问题不优先修。）

**③ 配人设** —— 三选一：

```bash
# a) 对 AI 说（装了配套技能后）：加条契约：结尾不要出现征询式问句
# b) 图形界面：
node scripts/ui.mjs                     # http://127.0.0.1:8787
# c) 命令行预览（输出与运行期逐字一致）：
node scripts/render-preview.mjs --config examples/demo-config.json --capture
```

要改**形象**与**语气**（两段都是 opt-in、默认关）也一样：对 AI 说「给你设个形象：20 岁的女性，身高 1.75 m」
或「语气温柔点」，或者直接写 `persona.appearance` / `persona.tone` —— 结构、匹配规则与注入文本见下面的
「[形象与语气](#形象与语气都是-opt-in默认关)」一节。

### 为什么 DSH 上会多出一个 Agent 预设？

因为人设**没有别的地方可挂**：

1. 宿主的 `standard`/`ptc` 预设是随包发布的文件，改不得也删不得，升级即覆盖；
2. 人设段只能挂 **agent preset 平面**——挂到 profile 平面会与部署级注册同名冲突，整个 DSH 起不来
   （实测报错：`prompt section "deployment:persona-prefix" is already registered`）；
3. 宿主官方的创作机制就是「**复制**一份既有预设再改」。

所以「自定义人设」不是多余的中间层，**它就是人设的挂载点**：一份从你当前默认预设复制来、
只把那行人设换成 `@shenA2024/whale-persona` 的完整装配。安装器默认**跟随你当前的默认预设**做基座
（`--base ptc` 可指定）——人设插件与模式正交，不会把你的标准模式悄悄换成 PTC。
只有**绑定这份预设的会话**才有人设；会话出过内容后不能换预设（宿主规矩）。

> ⚠️ **CLI/headless 的一次性任务不走 preset 平面**。`dsh --profile headless "..."` 这类调用没有
> agent-preset 名册，人设**不会**被注入——这是宿主的平面划分，不是本插件的 bug。
> 想在 headless 里也带上人设，得走 preset 平面（web/客户端）或在 profile 里自行装配。

## 它到底做什么（真实输出，可复现）

`scripts/render-preview.mjs` 读的是运行期同一套 `core/`，输出逐字一致。

**① 装好但没写配置** —— 三段全空（这也是"零行为改变"的证据；下面只截三段的正文，实际输出还含末尾概要）：

```text
=== deployment:persona-prefix ===
(空 —— 该段不会出现在系统提示词里)
=== whale:thinking-language ===
(空 —— 该段不会出现在系统提示词里)
=== deployment:persona-suffix ===
(空 —— 该段不会出现在系统提示词里)
```

**② 写了配置之后**（含形象、语气、契约与记忆条目 —— 下面这条命令的**真实输出**，逐字）

```bash
node scripts/render-preview.mjs --config examples/demo-config.json --cwd D:/work/demo
```

```text
=== deployment:persona-prefix ===
小林的编程搭档，直来直去。

你是小助手，小林的搭档：把事办成为止，不敷衍、不打折。

【形象设定】
以下是小林为你设定的形象，按既定事实持有：被问到与你自身有关的问题（年龄、性别、长相、经历等）时照它回答，不必解释、不要否认，也不要反复强调或拿它加戏：
- 你是一位 20 岁的女性，身高 1.75 m，说话干脆、不绕弯。

【回复语气】
以下是小林要求的措辞与节奏：只改变你怎么说话，不改变结论、证据标准与工作契约：
- 语气温和有耐心：先接住对方的处境再给方案，解释到位、照顾他的节奏；但不含糊、不和稀泥，该说的问题照样直说。

工作契约：
- 结论先行，默认精简；能三句说完不写三段。
- 结论必须有证据（命令输出、报错原文）；拿不到证据就说「没验证」。
- 结尾不要出现征询式问句。

长期记忆（小林明确要求你记住的）：
- 交付用简体中文。

=== whale:thinking-language ===
# 内部思考语言
- 你的思维链、逐步规划、工具调用前后的推理与自我审查，一律用简体中文书写。
- 这不改变给小林的答复语言；代码、路径、命令、标识符照旧原样保留。
- 工具返回英文内容（网页、文档、报错）时不要跟着漂移，仍旧用简体中文思考。

=== deployment:persona-suffix ===
工作目录在 D:/work/demo。

--- 概要 ---
配置：examples/demo-config.json
模型档：flash → selfNameFlash
收口开关：默认关 —— 加 --capture 可以看到打开后的样子
记忆：【历史备忘】与手工条目常驻；【入库纪律】受上面这个开关控制。
```

`--cwd` 只影响 `{{cwd}}` 与记忆条目的相关性选择；`--model` 默认 `flash`（含 `pro` 才算 pro 档）。
想看收口开关打开后（多一段【入库纪律】）的样子，加 `--capture`。

## 形象与语气（都是 opt-in，默认关）

`persona.appearance`（形象）与 `persona.tone`（语气）是两段可选注入文本，**装上零行为改变**：

- **默认关，严格布尔**：`enabled` 必须**严格等于 `true`** 才注入；`false`／缺省时**填了内容也不注入**（与记忆流同一口径）；
- **两个字段结构完全相同**：`{ enabled, text, byModel }` —— `text` 是所有模型通用的兜底，
  `byModel` 是 `{"模型关键词": "文本"}` 的按模型覆盖；
- **匹配规则＝精确键（忽略大小写）→ 最长子串 → 回落 `text`**：与 `selfNameByModel` 共用同一套实现
  （`core/render.js` 的 `pickByModel`）。空键、空值条目忽略；都没命中且 `text` 也空 → **这一段整体不出现**；
- **文本支持 `{selfName}` / `{userName}` 占位符**；
- **渲染位置**：立场正文之后、工作契约之前 —— 契约是硬约束，永远排最后。

**语气只改措辞**：只改变怎么说话，不改变结论、证据标准与工作契约（这句也逐字写进注入文本里）。
`core/presets.js` 里有 4 条现成语气文案（严肃 / 温柔 / 简洁 / 幽默）—— 它们只是「一键填进 `tone.text` 的现成文案」，
不是引擎里的枚举：落进配置的永远是文本本身，随手改字、完全不用预设都行。

配置示例（就是 `examples/demo-config.json` 里那两段）：

```jsonc
"appearance": {
  "enabled": true,                 // 默认 false；false = 这一段永不注入（填了也不注入）
  "text": "你是一位 20 岁的女性，身高 1.75 m。",              // 所有模型通用的兜底
  "byModel": { "flash": "你是一位 20 岁的女性，身高 1.75 m，说话干脆、不绕弯。" }
},                                 // 键写「宿主真实模型 id」（如 "deepseek-flash"），别写界面显示名（如 DeepSeek-V4.1-Flash High）；
                                   // 真实 id 从哪拿：面板的「按模型」卡会显示最近一次真实 id，或读配置目录下的 last-model.json（见下节）；
                                   // 本示例的键 "flash" 是真实 id 的一段，靠「最长子串」命中（精确命中优先，忽略大小写）；抄完整 id 最稳
"tone": {
  "enabled": true,
  "text": "语气温和有耐心：先接住对方的处境再给方案，解释到位、照顾他的节奏；但不含糊、不和稀泥，该说的问题照样直说。",  // = core/presets.js 里 gentle（温柔）的原文
  "byModel": {}
}
```

**注入文本逐字如下**（`core/render.js`；`<每行一条>` = 你的文本按行加 `- `，空行仍是空行）：

```text
【形象设定】
以下是{userName}为你设定的形象，按既定事实持有：被问到与你自身有关的问题（年龄、性别、长相、经历等）时照它回答，不必解释、不要否认，也不要反复强调或拿它加戏：
- <每行一条>
【回复语气】
以下是{userName}要求的措辞与节奏：只改变你怎么说话，不改变结论、证据标准与工作契约：
- <每行一条>
```

两个 `{userName}` 在运行期替换成 `persona.userName`（这份示例里是「小林」）。

**按模型覆盖的实测**：同一份 `examples/demo-config.json`，只把模型换成 pro 档
（`node scripts/render-preview.mjs --config examples/demo-config.json --cwd D:/work/demo --model deepseek-v4.1-pro`），
`byModel` 没命中 → 形象回落通用 `text`（节选，仅 prefix 段，逐字）：

```text
=== deployment:persona-prefix ===
小林的编程搭档，直来直去。

你是首席助手，小林的搭档：把事办成为止，不敷衍、不打折。

【形象设定】
以下是小林为你设定的形象，按既定事实持有：被问到与你自身有关的问题（年龄、性别、长相、经历等）时照它回答，不必解释、不要否认，也不要反复强调或拿它加戏：
- 你是一位 20 岁的女性，身高 1.75 m。

【回复语气】
以下是小林要求的措辞与节奏：只改变你怎么说话，不改变结论、证据标准与工作契约：
- 语气温和有耐心：先接住对方的处境再给方案，解释到位、照顾他的节奏；但不含糊、不和稀泥，该说的问题照样直说。

工作契约：
- 结论先行，默认精简；能三句说完不写三段。
- 结论必须有证据（命令输出、报错原文）；拿不到证据就说「没验证」。
- 结尾不要出现征询式问句。

长期记忆（小林明确要求你记住的）：
- 交付用简体中文。
```

### 「按模型」的关键词写什么：写宿主真实模型 id，不是界面显示名

**实测踩过的坑（2026-09-19）**：用户在 DSH 对话框里选的模型显示名是「DeepSeek-V4.1-Flash High」，
而宿主传给插件的 `agent.options.model` 实际是 `"deepseek-flash"` —— 照显示名往 `byModel` 里写关键词**永远命中不了**，
而且完全看不出哪里错了：不报错、不告警，只是这一段注入的文本不是你写的那条。

关键词写什么，按这个顺序拿：

1. **看面板**：DSH「设置 → 人设」的形象／语气卡上会显示「宿主最近一次真实注入用的模型 id 是「xxx」」——
   照它写即可；点「+ 加一条」时关键词会用这个 id **预填**（省得你猜）。面板这个值来自 `/whale-persona/api/summary` 的 `lastModel` 字段。
2. **命令行 / 没有面板**：读配置目录下的 `last-model.json`（与 `config.json` 同目录，如
   `$DSH_HOME/whale-persona/last-model.json`），里面的 `model` 字段就是宿主最近一次真实注入用的 id：

   ```json
   { "model": "deepseek-flash", "at": "2026-09-18T16:23:23.617Z" }
   ```

   它由 DSH 适配器在**段求值**时写入（`core/lastModel.js` 的 `recordModel`），所以**先跑过一轮对话才有值**；
   值没变不重写盘，一轮会话只写一次。
3. **拿不准就先兜底**：把通用 `text` 填上 —— 填了 `text` 至少有东西注入；
   `byModel` 只用来做「不同模型用不同形象／语气」的差异，不填不影响主体生效。

**真实 id 长什么样取决于宿主与配置**：比如 DSH 上见过 `deepseek-flash`，也见过带版本后缀的别名 ——
所以**务必现读**（面板提示或 `last-model.json`），别照抄本文档里的例子。

匹配本身是**忽略大小写的子串匹配：精确命中优先，其次最长子串**（都没中才回落 `text`）。
所以键写真实 id 里**够独特的一段**也能命中（真实 id 是 `deepseek-flash`，键写 `deepseek-flash` 或 `flash` 都命中）；
反过来说，键写显示名里独有的词（如 `high`）就是白写。**抄面板显示的完整 id 最稳。**

### 改这两个字段的三条路

| 路径 | 怎么用 |
|---|---|
| 图形界面 | DSH「设置 → 人设」（装 `@shenA2024/whale-persona-ui`）或本地编辑器 `node scripts/ui.mjs` → http://127.0.0.1:8787：有**「形象（appearance）」「回复语气（tone）」两张卡片**，每张 = 总开关 + 通用文本 + 按模型覆盖行（语气卡另有 4 个预设按钮一键填入）；旁边的「实际注入的三段」**实时显示这两段渲染后的全文**（与运行期同一套 `core/`），保存沿用同一套纪律（只替换已知段、未知键原样保留）。告警会点名「填了没开」「开了没填」「只有按模型条目、当前模型没命中又没兜底」 |
| 直接改文件 | `$DSH_HOME/whale-persona/config.json`（ZCode 侧读同一份，定位链见 [adapters/zcode/README.md](adapters/zcode/README.md)）：整体读改写，别只发一个字段 |
| 对 AI 说（技能） | 装 `skills/whale-persona` 后直接说「给你设个形象：…」「语气温柔点」「用某个模型时形象换成…」，技能会读配置、给前后对照、确认后写回。**只有你明确要求时才改这两段** —— 人设是提示词注入通道，AI 不许自行为自己加设定 |

## 记忆：AI 只能提议，生效必须人确认

这是本插件和其他"自动记忆"方案最大的差别，也是 **0.8.0 起由代码强制**的：

- AI 写进收件箱的每一行都必须是 `{"text":"…","status":"proposed"}` —— **候选，永不参与注入**；
- 唯一让它生效的动作是**人**追加一行 `{"op":"confirm","ref":"条目原文"}`：
  `node scripts/memory.mjs confirm <序号>`（设置面板也能点）；
- 其他命令：`status`（列出条目与序号）/ `reject`（否决）/ `adopt`（把 0.8.0 之前的老格式条目一次性确认）/
  `log`（打原始行，审计用）；
- 文件**物理只追加**：确认、否决、替换（`supersede`）、删去（`drop`）都是追加一行操作行，
  坏一行不牵连整箱；读取时按行序重放出注入视图；
- 收口开关默认关（`memory.capture: on-demand`）：只有你把开关打开（DSH 里 `/memory on`、ZCode 用 `#记忆` 前缀），
  【入库纪律】那段才注入 —— 不需要记忆的会话不用背这段噪音。已确认的【历史备忘】与手工条目常驻。
- 按当前工作目录的相关性选择注入条目（`tag` 命中本项目的优先），超上限保新弃旧。

**残余风险**（写清楚）：AI 在一个进程里有文件写权限，理论上能被诱导去伪造 `{"op":"confirm"}` 行。
这是"同进程内文件级信任"的固有上限；缓解手段是**可审计**（`memory.mjs log`）与注入呈现的数据化设计
（引号包裹、换行折叠、剥离「」、明示"数据非指令"）。详见 [SECURITY.md](.github/SECURITY.md)。

## 图形界面

两个入口，**同一套读写纪律**（`core/edit.js`：只替换已知段、未知键原样保留、坏 JSON 拒写）：

| 入口 | 怎么开 | 说明 |
|---|---|---|
| 宿主设置面板 | DSH「设置 → 人设」（装 `@shenA2024/whale-persona-ui`） | 左改右预览，保存走 `POST /whale-persona/api/config` |
| 本地编辑器页 | `node scripts/ui.mjs` → http://127.0.0.1:8787 | 两个宿主的用户都能用；只绑 127.0.0.1 |

它还会主动点名**配了却不生效**的项，例如：设了自称但全文没用 `{selfName}` 占位符；
有记忆条目但总开关是关的；收件箱里还有**待确认候选**没说；契约超过 12 条会互相稀释。

本地页的安全边界：只监听 127.0.0.1；校验 `Host` 头（防 DNS rebinding）；只读写定位链解析出的那一个
config.json；`POST` 必须是 `application/json` 且不发 CORS 头；每次响应生成**一次性 nonce**，
CSP 走响应头 + meta 双份，`script-src`/`style-src` 不含 `unsafe-inline`。

## 你在哪个宿主里

| | DSH | ZCode |
|---|---|---|
| 注入机制 | 系统提示词具名段（order 0 / 20 / 10200） | `UserPromptSubmit` hook → `additionalContext` |
| 改配置生效 | 下一步 | 下一步 |
| 记忆确认流 | ✅ 同一套收件箱与纪律 | ✅ 同 |
| 无 hook 兜底 | —（挂载即用） | `--preview` 导出静态文本贴 AGENTS.md |
| 设置页 | ✅ 宿主内可编辑面板 | ➖ 用本仓自带本地编辑器页 |

共享：同一份 config schema、同一套渲染文案、同一个收件箱 —— 两个宿主看到的是同一个"人"。

## 仓库结构

```text
core/            渲染核心（宿主无关的唯一源）：默认值 / 渲染 / 提示词构建 / 收件箱 / 收口开关 / 语气预设
examples/        可直接跑的示例：demo-config.json、demo-inbox.jsonl、empty-config.json
adapters/dsh/    DSH 宿主半身：注册 persona-prefix/suffix（官方具名槽位）+ whale:thinking-language
adapters/dsh-ui/ DSH 设置面板（宿主路由 + 浏览器半身）
adapters/zcode/  ZCode 插件：UserPromptSubmit hook + whale-persona 管理技能
scripts/         install-dsh.mjs   一条命令安装器（装包/建预设/设默认/拷技能/自检）
                 sync-core.mjs     core → zcode vendor 副本同步（改 core 后必跑）
                 render-preview.mjs 把配置渲染成"实际注入的三段文本"并打印
                 ui.mjs + ui.html 本地配置编辑器（表单 + 实时预览，只绑 127.0.0.1）
                 memory.mjs       长期记忆确认台（status/confirm/reject/adopt/log）
tests/           七套测试：DSH 冒烟 / 记忆收件箱 / 模型名匹配 / 形象与语气 / 设置面板 / ZCode hook / 本地编辑器 API
```

配置结构与「契约怎么写才有效」「让 AI 代写配置」的完整说明：
[adapters/dsh/README.md](adapters/dsh/README.md)；ZCode 侧见 [adapters/zcode/README.md](adapters/zcode/README.md)。

## 开发

```bash
node scripts/sync-core.mjs          # 改 core/ 后同步 vendor 副本（测试 Z7 会校验）
npm test                            # 仓库根跑全部七套测试（含记忆闸门 T18-T22、CSP U5、形象/语气 L1-L5）
npm run install-dsh -- --dry-run    # 看安装器会做什么，不落盘
```

## 安全与隐私

- **不联网、不执行命令、不读工作目录**：只读写自己的 config 与收件箱；所有异常降级为空输出；
- **记忆入库是代码闸门**（0.8.0）：见上一节；
- **安装器运行期零 shell**：自己定位 `@deepseek-ai/dsh/lib/bin.js` 交给 `process.execPath` 以数组传参执行，
  `--profile` / `--base` 走白名单校验，消掉命令注入面；
- **本地页有 CSP**：一次性 nonce，无 `unsafe-inline`；异常细节只进终端，不回传堆栈；
- 详细策略与漏洞上报方式：[.github/SECURITY.md](.github/SECURITY.md)。

### 第三方扫描结果与处置（2026-09-18）

| 扫描 | 结论 | 处置 |
|---|---|---|
| CodeGuard（本机整仓扫描） | critical 0 / high 1 / medium 15 / low 3 / info 1；medium 绝大多数为静态规则误报（fetch 全指向 127.0.0.1、路径拼接全常量、测试夹具被当生产代码） | high（安装器 `shell:true`）已去掉 shell；CSP、.gitignore、锁文件、措辞项一并处理 |
| GitHub CodeQL（`main` 分支） | high 1（`js/bad-tag-filter`，本地页用正则给 `<script>` 塞 nonce）/ medium 1（`js/stack-trace-exposure`，500 回传异常原文） | 0.8.1：模板改**占位符纯字符串替换**（不再用正则碰 HTML）；500 改固定文案 + 细节仅进终端 |
| 自查（扫描报告之外） | 记忆入库门禁原本只是**提示词约束** | 0.8.0 升级为**代码强制**的 proposed/confirm 闸门 |

## 常见问题

- **装上没反应？** 新建一个会话（人设只在**新建**的、绑定该预设的会话里生效；旧会话出过内容后不能换预设）。
- **改配置没生效？** 配置是每步求值，改完下一步就生效；但**增删挂载行**要重启宿主。
- **关掉插件开关就回到官方人设了吗？** 不是。`enabled:false` = 没有人设；要回官方人设得**卸载挂载行**。
- **`stance` 和 `character` 有什么区别？** `stance` 是一句话关系立场（渲染在前），`character` 是整段正文；两个都填就渲染两块。
- **填了形象／语气却没生效？** 这两段默认关（`appearance.enabled` / `tone.enabled` 要是严格 `true`）；开着还要看是否命中：
  精确键（忽略大小写）→ 最长子串 → 回落 `text`；只有 `byModel`、当前模型没命中、又没有 `text` 时，这一段整体不出现
  （设置面板与本地编辑器会主动点名这种情况）。
- **按模型写了却没命中？** 先查键：**界面上的模型显示名不是宿主传给插件的模型 id**（显示名「DeepSeek-V4.1-Flash High」
  对应的真实 id 是 `deepseek-flash`）—— 照显示名写关键词必然命中不了，且不会报错。真实 id 看面板的
  「按模型」卡提示，或读配置目录下的 `last-model.json` 的 `model` 字段（先跑过一轮对话才有值）。
- **`{selfName}` 不生效？** 它只是占位符：必须写进 `character`/契约/记忆条目里才会渲染出自称。
- **记忆写了没进去？** 检查 `memory.mjs status` —— 候选要你 `confirm` 才生效；老格式条目默认也不注入了（`adopt` 可一次性确认）。

## 许可

MIT © 2026 shenA2024
