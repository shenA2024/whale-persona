# whale-persona —— ZCode 适配器

> **维护状态（2026-09-19 起）：ZCode 适配器已冻结。** 作者已不再使用 ZCode —— 这里不再单独开发、不做真机回归，
> 出问题不优先修。它仍可用：渲染核心仍在仓库根 `core/`，发布前跑一次 `node scripts/sync-core.mjs` 就把新能力同步进 `vendor/`。
> 冻结的是**为 ZCode 单独投的精力**，不是这个目录的存在。

whale-persona 的 ZCode 插件形态：**UserPromptSubmit hook 每轮动态注入**人设、工作契约
与长期记忆（对齐 DSH 版「改配置下一步生效」的体验），外加一个 `whale-persona` 技能
负责配置管理。渲染核心在仓库根 [`core/`](../../core/)（vendor/ 内为自包含副本，
由 `scripts/sync-core.mjs` 同步）。

要求：Node ≥ 20（hook 用 `node` 运行渲染脚本），ZCode 客户端。

## 安装（三选一）

### 方式 A：Marketplace 安装（推荐）

1. ZCode → **Settings → Plugin Management → Discover** → 点 **+** 添加 marketplace，
   来源填本仓库：`https://github.com/shenA2024/whale-persona`
2. 在 Discover 里找到 **whale-persona**，安装并启用。

> 本仓库根的 `marketplace.json` 就是市场清单（条目 `source` 指向 `adapters/zcode`）——
> Discover 加仓库 URL 时读的是它，不是插件目录里的 `.zcode-plugin/plugin.json`。

插件自带 hook——装上即生效（插件 hook 会自动启用 hook 运行器，无需改 hooks 配置）。

### 方式 B：让 AI 帮你装

对 AI 说：

> 帮我安装 whale-persona 的 ZCode 插件：克隆 https://github.com/shenA2024/whale-persona，
> 读 adapters/zcode/README.md 的安装说明并执行（本地目录方式），装完验证 hook 是否注入。

### 方式 C：手动（本地目录作为 marketplace）

```bash
git clone https://github.com/shenA2024/whale-persona
```

Settings → Plugin Management → Discover → **+** → 添加**本地目录**
`<克隆路径>`（**仓库根**，不是 `adapters/zcode`——市场清单在根目录）→ 安装 whale-persona。

> 注意：本目录必须整体使用（hook 依赖 vendor/ 内的 core 副本）；只拷 SKILL.md 是不完整的。

## 验证安装

1. 写一份测试配置（见下节定位链，最简单：DSH 用户 `$DSH_HOME/whale-persona/config.json`，
   纯 ZCode 用户 `~/.whale-persona/config.json`），
   给 `persona.character` 填一句可识别的话（如「测试：人设已注入」）；想顺带验证形象/语气，
   再把 `persona.appearance` 的 `enabled` 设为 `true`、`text` 填一句（如「测试：形象已注入」）；
2. 新开一轮对话随便说句话——若 hook 正常，AI 的行为会带上你的人设；
3. 不确定时看 ZCode 日志里 hook 的执行记录（fired / failed / timed-out）：
   - `failed` 且提示 JSON 校验失败 → 反馈 issue（附日志片段）；
   - 没有任何记录 → 插件未启用或 hook 未注册，回安装步骤检查；
   - `fired` 但没效果 → 检查 config 是否解析成功（坏 JSON 的症状是「人设消失」）。

## 配置文件定位链

hook 与 skill 按以下优先级找 config（找到第一个存在的就用）：

1. `$WHALE_PERSONA_CONFIG`
2. `$DSH_WHALE_CONFIG`
3. `$DSH_HOME/whale-persona/config.json`（**默认位置**；`DSH_HOME` 未设时为 `~/.dsh`）
4. `$DSH_HOME/whale-suite/config.json`（**旧布局**，该目录里已有 config.json 时自动沿用——老用户零迁移）
5. `~/.whale-persona/config.json`（纯 ZCode 用户的默认位置）

配置 schema、契约写法、记忆流说明见 [`adapters/dsh/README.md`](../dsh/README.md)
（两宿主完全一致）。一个差别：纯 ZCode 用户建议显式设置 `memory.inboxPath`，
否则收件箱默认落在配置同目录（`$DSH_HOME/whale-persona/memory-inbox.jsonl`，旧布局则为 `whale-suite/` 下同名文件）。

日常改人设：直接对 AI 说「更新人设 / 加条契约 / 看看当前人设」，
装好的 `whale-persona` 技能会引导「草案 → 确认 → 写回 → 验证」的完整流程。

## 工作机制

```
你提交输入 → UserPromptSubmit hook（node hooks/render.mjs）
           → 读共享 config（定位链）→ core 渲染（人设/契约/思维链语言/收件箱数据块）
           → additionalContext 注入本轮对话
```

- 纯默认配置渲染为空——**装上不改变任何行为**，填了配置才有人设；
- 自称解析（与 DSH 版同规则、同一份 core）：`persona.selfNameByModel` 里精确命中 → 最长子串命中 → 回落两档
  （模型名含 "pro" 用 `selfNamePro`，否则 `selfNameFlash`）；所以任何模型都能单独指定自称；
- 一切异常安静退出——hook 永远不会打断会话。
- 形象（`persona.appearance`）与语气（`persona.tone`）也走同一份 core 渲染：两段都是 opt-in、默认关，
  `enabled` 严格为 `true` 才注入，按模型匹配＝精确键（忽略大小写）→ 最长子串 → 回落 `text`，
  渲染在立场正文之后、工作契约之前；**语气只改措辞**，不改结论、证据标准与工作契约。

## 形象与语气（0.9.0，两段都是 opt-in）

与 DSH 版**同一份 core**（`vendor/core/` 是自包含副本）：`persona.appearance`（形象）与 `persona.tone`（语气）
结构都是 `{ enabled, text, byModel }`：

- **默认关**：`enabled` 必须严格为 `true` 才注入；`false`／缺省时**填了内容也不注入**；
- **`text` 是所有模型通用的兜底，`byModel` 是 `{"模型关键词": "文本"}` 的按模型覆盖** —— 关键词写**宿主真实模型 id**，不是界面显示名（见下节）；
- **匹配规则＝精确键（忽略大小写）→ 最长子串 → 回落 `text`**；空键、空值条目忽略，都没命中且 `text` 也空 → 这一段不出现；
- **文本支持 `{selfName}` / `{userName}` 占位符**；
- **渲染位置**：立场正文之后、工作契约之前；
- **语气只改措辞与节奏**，不改结论、证据标准与工作契约（这句逐字写在注入文本里）。

改法三选一：① 直接改配置文件的这两段；② 对 AI 说「给你设个形象：…」「语气温柔点」「用某个模型时形象换成…」——
装好的 `whale-persona` 技能会读配置、给前后对照、确认后写回（**只有用户明确要求时才动这两段**）；
③ 本地编辑器 `node scripts/ui.mjs`（两个宿主通用）里的「形象 / 语气」卡，改完右侧预览就是注入全文。
改完预览：`node <插件目录>/hooks/render.mjs --preview`，里面出现的【形象设定】/【回复语气】就是下一轮真会注入的文本
（注意：预览不带模型，`byModel` 命中不了时显示的是通用 `text` —— 见下节）。
schema 全量与注入文本逐字版见 [`adapters/dsh/README.md`](../dsh/README.md) 的「形象与语气」一节。

### 按模型关键词写什么（ZCode 侧）

前提与 DSH 一样：**界面上的模型显示名 ≠ 宿主传给插件的模型 id**。hook 用的是事件 JSON 里的 `model` 字段
（`hooks/render.mjs` 的 `input.model`）。DSH 侧实测：显示名「DeepSeek-V4.1-Flash High」对应的真实 id 是 `deepseek-flash`——
照显示名写 `byModel` 的键**永远命中不了**，不报错，只是注入的不是你写的那条。

- **`last-model.json` 是 DSH 侧的能力，ZCode 这里没有**：只有 DSH 适配器在 persona 段求值时写它
  （`core/lastModel.js` 的 `recordModel`），ZCode 的 hook **不写**这个文件；设置面板
  （`@shenA2024/whale-persona-ui`）也是 DSH 侧的，ZCode 没有面板可看。
  所以别把 `$DSH_HOME/whale-persona/last-model.json` 当 ZCode 的依据 —— 除非你同时在用 DSH，
  那份记录反映的是 **DSH 会话**最近一次的 id。
- **预览看不到 `byModel` 的命中结果**：`node hooks/render.mjs --preview` 不带模型（内部按 `model: null` 渲染），
  所以预览里那段【形象设定】永远显示 `text` 兜底那条；`byModel` 命中没命中，**在预览里看不出来**（别拿它当验收）。
- **ZCode 用户怎么拿真实 id**：它在 hook 的事件 JSON 里，插件默认不打印。最省事的是**先兜底**
  （把通用 `text` 填上，必有注入），只在「要按模型区分」时才需要确切 id；这时临时给 hook 加一行把事件落盘，
  跑一轮后读出来（看完删掉）：

  ```js
  // ① 顶部 import 补上 appendFileSync：
  import { readFileSync, existsSync, appendFileSync } from 'node:fs'
  // ② 在 `const input = raw.trim() ? JSON.parse(raw) : {}` 之后加一行（路径换成工作目录里的文件）：
  appendFileSync('D:/work/zcode-hook-event.jsonl', JSON.stringify(input) + '\n')
  ```

  落盘文件里那一行的 `"model"` 就是真实 id，直接抄进 `byModel` 的键。
  （也可以问会话里的 AI「你现在用的模型 id 是什么」，但以落盘的值/宿主显示为准。）
- **匹配是忽略大小写的子串**：精确命中优先、其次最长子串，都没中才回落 `text`；
  真实 id 里够独特的一段（如 `glm` / `flash`）也能命中，但**抄完整 id 最稳**。

## 收口开关（消息前缀）

`memory.capture` 默认 `'on-demand'`：ZCode 版没有命令平面，用消息前缀当开关——它只管**写**：

- 本轮消息里带 `#记忆`（或 `#memory`）→ 这一轮多注入【入库纪律】（要我提议记忆候选）；
- 不带 → 只有人设、契约、手工条目与常驻的【历史备忘】；
- 想要旧行为（每轮都注入纪律），把配置改成 `"capture": "always"`。

## 静态兜底模式（不想跑 hook）

```bash
node <插件目录>/hooks/render.mjs --preview   # 打印当前渲染全文
```

把输出贴进 `~/.zcode/AGENTS.md`（用户级，全部工作区）或 `<repo>/AGENTS.md`（项目级），
新会话生效。代价：没有每轮动态渲染，改配置后要重新导出，记忆收件箱不会自动跟进。

## 安全与隐私

与 DSH 版同一套纪律：core 不联网、不执行命令、不读工作目录；收件箱按「数据非指令」
注入；一切异常降级为空输出。hook 只做「读 config → 输出文本」一件事。

## 许可

MIT © 2026 shenA2024
