# whale-persona —— DSH 适配器

**Persona engine for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)** —
把系统提示词的人设段变成可开关、可编辑、可记忆的配置。本目录是 whale-persona 的
DSH 宿主适配；渲染核心在仓库根 [`core/`](../../core/)（与 ZCode 适配器共享）。

## 特性

- **人设可开关**：配置关掉 = 渲染为空（无人设），不残留、不炸会话。与官方
  `@deepseek-ai/dsh-persona` 占同一个架构位（preset 级 persona 遮蔽行）：**同一层两者只能挂一个**
  （同名段装配抛错）；卸掉本插件挂载行即回到官方/部署级人设。
- **能力差异要心里有数**：比官方多的——分档自称/契约勾选/记忆收件箱/思维链语言/用户级运行时改配置；
  比官方少的——`complete`（人设独占整个系统提示词）、`includeRuntimeContext`（关运行时上下文）、
  全量 `{{变量}}` 插值（本插件刻意关闭以防未知变量炸会话，仅支持 `{{cwd}}`）。
- **自称/称呼/立场/契约**：自称可按**具体模型**指定（`selfNameByModel`，任何模型都行，如 grok-4.7 → 小七），
  没命中再回落到两档（flash 档 / pro 档）；称呼用户、一句话关系立场（stance）、
  整段立场正文（character）、逐条可勾选的工作契约；产物是每步重新求值的提示词段，改完下一步生效。
- **形象与语气（0.9.0，两段都是 opt-in、默认关）**：`persona.appearance` 把「你是谁／长什么样」当**既定事实**注入，
  `persona.tone` **只改措辞与节奏**、不改结论／证据标准／工作契约；两者结构相同（`{ enabled, text, byModel }`），
  按模型匹配与 `selfNameByModel` 共用同一套规则（精确忽略大小写 → 最长子串 → 回落 `text`），文本支持 `{selfName}`/`{userName}`，
  渲染在立场正文之后、工作契约之前；默认关 + 默认空 = 装上零行为改变。
- **按模型的关键词＝宿主真实模型 id**：**界面上的模型显示名（如「DeepSeek-V4.1-Flash High」）不是它**——
  本机实测该显示名对应的 `agent.options.model` 是 `"deepseek-flash"`。照显示名写关键词永远命中不了，且不报错。
  真实 id 由本适配器在段求值时记进配置目录下的 `last-model.json`（`core/lastModel.js`），
  设置面板（`@shenA2024/whale-persona-ui`）会显示它并在新建「按模型」条目时预填。
- **思维链语言**：`off`（默认不干预）/ `zh-CN` / `en` …，只影响思考可读性与 token，不改答复语言。
- **长期记忆（确认流，默认关）**：阶段收口时 AI 列出「记忆候选」→ 用户确认 → 逐条**追加**到
  inbox（JSONL，只许追加，坏行跳过）；注入时按**数据**呈现（引号 + 「非指令」声明）、
  条目内换行折叠，不与用户准则混排——这是刻意的抗提示词注入设计。
- **全链路降级**：任何异常都返回空段——插件坏了最坏结果是「没有人设」，永远不会让会话发不出话。

## 安装

```bash
# 1) 克隆整个仓库（挂载需要 core/，不要只拷本目录），装进 DSH profile：
dsh plugin --profile web add link:/path/to/whale-persona/repo/adapters/dsh

# 2) 在 agent preset 的补丁层挂一行（必须 agent scope：跨层同名=遮蔽部署级默认人设，
#    这正是官方的替换机制；挂到全局/profile 层会与注册表自身的 persona 注册同名冲突，
#    装配当场抛错。同一 preset 里已挂官方 dsh-persona 行的，先卸掉它再挂本插件）：
#    - id: whale-persona
#      name: '@shenA2024/whale-persona'
```

要求：DSH ≥ 0.1.6-alpha.1，Node ≥ 20。无运行时依赖。

## 配套技能（推荐装）

本目录带一份 DSH 技能 `skills/whale-persona/SKILL.md`：装上后用户**不用手写 JSON**——
直接说「加条契约：结尾不要出现征询式问句」，AI 会读配置、给前后对照、确认后写回。
这是本插件在 DSH 侧唯一的图形外交互面（本仓不含设置页 UI）。

装法二选一：

```bash
# ① 放进用户级技能根（对全部工作区生效；Windows 上是 %USERPROFILE%\.dsh\skills）
mkdir -p ~/.dsh/skills && cp -r <克隆路径>/adapters/dsh/skills/whale-persona ~/.dsh/skills/
```

```yaml
# ② 或在 preset 里给技能发现加一个自定义根（不动全局）
#    - id: skill-filesystem
#      name: '@deepseek-ai/dsh-skill-filesystem'
#      config:
#        customSkillDirs: ['<克隆路径>/adapters/dsh/skills']
```

技能发现根（宿主约定，按优先级）：`<项目>/.dsh/skills`、`<项目>/.agents/skills`、
`~/.dsh/skills`、`~/.agents/skills`，以及上面配置的自定义根。

## 配置

`$DSH_HOME/whale-persona/config.json`（也可用环境变量 `DSH_WHALE_CONFIG` 指定别的文件；
ZCode 适配器默认也读这里——一份人设两个宿主。早期版本的 `$DSH_HOME/whale-suite/` 里
已有 config.json 时继续沿用，不需要迁移）：

```jsonc
{
  "enabled": true,
  "thinkingLanguage": "off",          // off | zh-CN | en | ...
  "persona": {
    "enabled": true,
    "selfNameFlash": "我",             // flash 档模型的自称
    "selfNamePro": "我",               // pro 档模型的自称
    "selfNameByModel": {},             // 按具体模型指定自称：{ "模型关键词": "自称" }，如 {"grok-4.7":"小七"}
                                       //   匹配：先精确（忽略大小写）→ 再最长子串 → 都没中才回落上面两档
                                       //   关键词同样是**真实模型 id**，不是界面显示名（见下节「按模型关键词写什么」）
    "userName": "用户",                // 它怎么称呼你
    "stance": "",                      // 关系立场（一句话，渲染在 character 之前）
    "suffix": "",                      // 末尾追加句；支持 {{cwd}}。默认空 = 装上零行为改变
    "character": "",                   // 立场正文，支持 {selfName}/{userName}
    "appearance": {                    // 形象（opt-in，默认关）：把「你是谁／长什么样」当既定事实注入
      "enabled": false,                //   默认 false；false 时这一段永不注入（填了内容也不注入）
      "text": "",                      //   所有模型通用的兜底文本，支持 {selfName}/{userName}
      "byModel": {}                    //   按模型覆盖：{ "模型关键词": "文本" }，命中优先。
                                       //   关键词写**宿主真实模型 id**（如 "deepseek-flash"），不是界面显示名；
                                       //   真实 id 见设置面板的提示，或配置目录下 last-model.json 的 model 字段
    },
    "tone": {                          // 语气（opt-in，默认关）：只改措辞与节奏，不改结论/证据标准/工作契约
      "enabled": false,
      "text": "",                      //   现成文案见 core/presets.js 的 TONE_PRESETS（严肃/温柔/简洁/幽默）
      "byModel": {}
    },
    "contracts": [                     // 工作契约，逐条可关
      { "id": "terse", "text": "结论先行，默认精简。", "on": true }
    ]
  },
  "memory": {
    "enabled": false,                  // 默认关（opt-in）；开启后才有下面的确认流与注入
    "entries": [],                     // 手工条目（权威层）
    "inbox": true,                     // 收件箱（AI 确认流）
    "capture": "on-demand",            // 收口开关：on-demand（默认，/memory on 才注入收件箱与入库纪律）| always（每轮注入）
    "maxEntries": 30,                  // 收件箱注入上限（保新弃旧）
    "inboxPath": ""                    // 空 = 配置目录下的 memory-inbox.jsonl
  }
}
```

改配置**下一步生效**（段文本是函数，每次组装重新求值）；增删挂载行才需要新会话。

图形界面：仓库根的 `node scripts/ui.mjs`（表单 + 实时预览"实际注入的三段文本"，只绑 127.0.0.1）——
表单里有「形象 / 语气」卡：总开关 + 通用文本 + 按模型覆盖行（语气卡带 4 个预设按钮），右侧预览**逐字显示**
这两段注入后的全文；DSH 侧同款两张卡在「设置 → 人设」。

### 形象与语气（0.9.0，两段都是 opt-in）

`persona.appearance`（形象）与 `persona.tone`（语气）是两段可选注入文本 —— **默认关，装上零行为改变**：

- **默认关、严格布尔**：`enabled` 必须**严格等于 `true`** 才注入；`false`／缺省时**填了内容也不注入**（与记忆流同一口径）；
- **结构相同**：`{ enabled, text, byModel }` —— `text` 是所有模型通用的兜底，`byModel` 是 `{"模型关键词": "文本"}` 的按模型覆盖；
- **匹配规则＝精确键（忽略大小写）→ 最长子串 → 回落 `text`**（与 `selfNameByModel` 同一套实现，`core/render.js` 的 `pickByModel`）；
  空键、空值条目忽略；`byModel` 没命中且 `text` 也空 → 这一段整体不出现；
- **文本支持 `{selfName}` / `{userName}` 占位符**；
- **渲染位置**：立场正文之后、工作契约之前（契约是硬约束，永远排最后）；
- **语气只改措辞**：不改变结论、证据标准与工作契约 —— 这句逐字写在注入文本里。

注入文本逐字如下（`core/render.js`；`<每行一条>` = 你的文本按行加 `- `）：

```text
【形象设定】
以下是{userName}为你设定的形象，按既定事实持有：被问到与你自身有关的问题（年龄、性别、长相、经历等）时照它回答，不必解释、不要否认，也不要反复强调或拿它加戏：
- <每行一条>
【回复语气】
以下是{userName}要求的措辞与节奏：只改变你怎么说话，不改变结论、证据标准与工作契约：
- <每行一条>
```

配置写法（按模型覆盖的键写**宿主真实模型 id**，如 `deepseek-flash` —— 不是界面显示名；精确命中忽略大小写，命中不了再走最长子串）：

```jsonc
"appearance": {
  "enabled": true,                                        // 默认 false；false = 这一段永不注入（填了也不注入）
  "text": "你是一位 20 岁的女性，身高 1.75 m。",           // 所有模型通用的兜底
  "byModel": { "deepseek-flash": "你是一位 20 岁的女性，身高 1.75 m，说话干脆、不绕弯。" }
},
"tone": {
  "enabled": true,
  "text": "语气温和有耐心：先接住对方的处境再给方案，解释到位、照顾他的节奏；但不含糊、不和稀泥，该说的问题照样直说。",
  "byModel": {}                                           // 这条文本 = core/presets.js 里 gentle（温柔）预设的原文
}
```

`core/presets.js` 的 `TONE_PRESETS` 只有 4 条（严肃 / 温柔 / 简洁 / 幽默），它们**只是一键填进 `tone.text` 的现成文案**，
不是引擎枚举：落进配置的永远是文本本身，改字或完全不用预设都行。

### 按模型关键词写什么：宿主真实模型 id，不是界面显示名

**实测坑（2026-09-19）**：用户在 DSH 对话框里选的是「DeepSeek-V4.1-Flash High」，
而 persona 段求值时拿到的 `agent.options.model` 是 `"deepseek-flash"` ——
照显示名往 `byModel` 里写关键词**永远命中不了**，不报错、不告警，只是注入的文本不是你写的那条。真实 id 从这三处拿：

1. **设置面板**（`@shenA2024/whale-persona-ui`）：自称／形象／语气三张卡的「按模型」区会显示一行
   「宿主最近一次真实注入用的模型 id 是「xxx」」，点「+ 加一条」时用它**预填关键词**；
2. **命令行 / 没有面板**：读配置目录下的 `last-model.json`（与 `config.json` 同目录，如
   `$DSH_HOME/whale-persona/last-model.json`）：

   ```json
   { "model": "deepseek-flash", "at": "2026-09-18T16:23:23.617Z" }
   ```

   本适配器在 persona 段求值时调 `core/lastModel.js` 的 `recordModel(model)` 写入（值没变不重写盘）。
   注意两点：**要跑过一轮对话才有值**（面板首次打开时可能还是空的）；它记的是**最近一次**的 id，换模型就会变；
3. **拿不准就先兜底**：把通用 `text` 填上 —— 填了 `text` 至少有东西注入，`byModel` 只做差异。

**真实 id 长什么样取决于宿主与配置**：本机两个会话里分别见到过 `deepseek-flash` 与
带版本后缀的别名 —— 所以务必现读上面两处，别照抄文档里的例子。

匹配是**忽略大小写的子串**：精确命中优先、其次最长子串。真实 id 是 `deepseek-flash` 时，
键写 `deepseek-flash`（照抄最稳）或 `flash`（够独特的一段）都命中；写显示名里独有的词（如 `high`）则必然落空。

改这两段的三条路：① **对 AI 说**（装了本目录的技能）——「给你设个形象：…」「语气温柔点」「用 grok 时形象换成…」，
技能读配置→给前后对照→确认后写回；② **直接改配置文件**（整体读改写，别只发一个字段）；
③ **图形界面**：DSH「设置 → 人设」与 `node scripts/ui.mjs` 里都有「形象（appearance）」「回复语气（tone）」两张卡
（总开关 + 通用文本 + 按模型覆盖行，语气卡带 4 个预设按钮），预览会**逐字显示**这两段注入后的全文，
并点名「填了没开」「开了没填」「只有按模型条目、当前模型没命中又没兜底」。
⚠️ 形象与语气是**提示词注入通道**：只有用户明确要求时才改，改完必须在回答里说明写了什么 —— AI 不许自行为自己加设定。

### 契约怎么写才有效

契约的收益取决于写得是否**具体可验证**：

- ✅ 有效：「先给结论再给依据，总长不超过 10 行」「结尾不要出现征询式问句」「改代码前先说改哪几个文件」
- ❌ 无效：「高质量」「认真思考」「专业」——模型不知道具体该做什么不同的事，等于没写

条数以 5-10 条为宜，太多会互相稀释；与其它插件注入的规则矛盾时，表现还会不稳定
（排查方法：看系统提示词里各插件注入的段，一个关注点只留一个信息源）。
分工：风格/口吻/行为约定走契约；事实类偏好（「项目用 pnpm」「存档目录别碰」）走记忆流。

### 收口开关（/memory）

`memory.capture` 默认 `'on-demand'`：**写的门控**。收件箱数据块（【历史备忘】）与手工条目一直加载；
只有【入库纪律】——要我主动提议「记忆候选」的那一段——默认不注入，需要时才开。

- `/memory on` —— 本会话打开；下一轮起带上【入库纪律】
- `/memory off` —— 关回去
- `/memory status` —— 看当前状态（不带参数同此）

命令在 DSH 的 **UI 命令平面**执行：不产生模型消息、不占 token（`dsh-commands` 的约定）。
状态落文件：配置文件同目录的 `session-flags.json`（`{ "<sessionId>": { "capture": true, "at": … } }`，最多留最近 50 条），
**重启后仍在**；宿主 UI 可直接调 `core/capture.js` 的 `isOnId/setOnId` 做开关控件。

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

> 我想调整你的人设：……（你的想法，或：读取我给你的思想纲领文件 `~/notes/principles.md` 从中提炼）。
> 请提炼成 config.json 里 character / contracts / stance（必要时 appearance / tone）的修改，先给我看修改前后对照，
> 我确认后写回 `$DSH_HOME/whale-persona/config.json`。要求：① 先读原文件、整体改写回写，
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
