# whale-persona —— DSH 设置面板（可编辑）

把「人设引擎此刻**实际会注入什么**」端到设置页，让用户看得见，不必问 AI。

布局是**五组 + 一条状态行**（2026-09-19 重排）：默认视图里同一条信息只出现一次，每张卡默认最多 3 行，
所有「说明 / 注意」一律收进折叠（`<details>`，默认收起，键盘可操作）。

```
设置 › 人设                                                      [预览档位][刷新][保存]
人设 · whale-persona                    改配置下一步生效 · 改挂载行要新会话
[✓] ● 已启用 · flash 档 · 思维链 [zh-CN]
配置 /home/you/.dsh/whale-persona/config.json [复制路径]

我是谁        自称 · 称呼 · 立场
  称呼与自称   自称 · flash 档 / pro 档 / 它怎么称呼你        ▸ 说明：…怎么进提示词
  按模型指定自称  1 条 · 逐模型覆盖上面两档                  ▸ 编辑条目与匹配规则
  立场与后缀   立场（一句话）/ 立场正文 / 后缀                ▸ 说明：{{cwd}} 与其它变量
我怎么说话    形象 / 语气 · 都是 opt-in
  形象与语气   总开关 ☑启用形象设定 形象（appearance） [已启用]  1 条按模型覆盖…
               总开关 ☑启用回复语气 回复语气（tone）  [关]      没有按模型覆盖…
我的硬约束    逐条可勾选
  工作契约     3 条 · 关掉的不进提示词（逐条开关 + 一条一句 + 删除）  ▸ 契约怎么才有效
我记住什么    长期记忆 · 默认关
  长期记忆     总开关 / 收口模式 / 手工条目                ▸ 说明 · ▸ 收件箱历史备忘（N 行）
此刻注入什么  flash 档 · 按模型档渲染，换档重取
  实际注入的三段  ▸ prefix（人设前缀 · 遮蔽部署级默认）  466 字符
                  ▸ thinking（思维链语言段）            121 字符
                  ▸ suffix（人设后缀）                   15 字符
本地编辑器（可选）                                     [打开] [复制命令]   ▸ 它是什么 · 怎么起…
```

「按模型条目怎么命中」（精确 → 最长子串 → 回落）**全页只讲一遍**：在「按模型指定自称」那张卡的折叠里，
形象 / 语气小节不再各重复一遍。三段预览默认也收起，摘要行给出字符数 —— 想看正文点一下。

## 它做什么

| 区块 | 能做 |
|---|---|
| 状态条 | 两行：`● 已启用 · flash 档 · 思维链 [zh-CN]` + `配置 <路径> [复制路径]`。总开关（勾选框就长在状态上）与思维链语言**就地可改**；档位判定规则、文件大小收进折叠；「还没写配置 = 装上零行为改变」只在文件不存在时多一行 |
| 我是谁 | **改** 自称（flash/pro 两档）、称呼、立场、立场正文、后缀；按模型指定自称（`+ 加一条`，关键词用宿主真实模型 id 预填） |
| 形象与语气 | **改** `persona.appearance`（形象）与 `persona.tone`（语气）：**一张卡里两个可折叠小节**（各自带开/关徽标与开关），形状相同 —— 总开关（opt-in，默认关，关着时填了也不注入）+ 通用文本 + 按模型覆盖行（`+ 加一条`，关键词用宿主真实模型 id 预填）；语气小节另有 4 个预设按钮一键填进「通用语气」。两段注入在立场正文之后、工作契约之前（卡头写明），三段预览逐字显示渲染结果 |
| 按模型关键词 | 三张「按模型」卡（自称／形象／语气）显示一行「宿主最近一次真实注入用的模型 id 是「xxx」」，点「+ 加一条」时用它**预填关键词**。这个 id 来自 `summary.lastModel`，读的是配置目录下的 `last-model.json`（由 DSH 适配器在段求值时写，见 `core/lastModel.js`）—— **界面上的模型显示名不是它**（显示名「DeepSeek-V4.1-Flash High」对应的真实 id 是 `deepseek-flash`），照显示名写关键词永远命中不了 |
| 工作契约 | **增删改** 逐条契约，每条单独开关；关掉的仍可编辑，只是不注入 |
| 长期记忆 | **改** 总开关、收口模式；**增删** 手工条目。收件箱最近几条只读（按**数据**呈现），收进「收件箱历史备忘」折叠 |
| 实际注入的三段 | 实时预览 `deployment:persona-prefix` / `whale:thinking-language` / `deployment:persona-suffix` 的**全文**（默认收起，摘要行给字符数），可按 flash/pro 档切换；保存后就地更新 |
| 告警 | 主动点名**配了却不生效**的项（自称没用 `{selfName}`、有条目但总开关关着、契约过多过长、形象/语气「填了没开」「开了没填」「只有按模型条目、当前模型没命中又没兜底」…） |

三段的文本来自仓库根 `core/`——与运行期注入**同一套渲染代码**，不是面板自己拼的近似值。

## 视觉：只有一层，永远跟随宿主（2026-09-19 收口）

面板**完全长在宿主的设计语言里**：只注入一层 `<style data-plugin="dsh-whale-persona-ui">`，
颜色全部取自 DSH 自己的 token（`--dsw-alias-*`），一个自己的色值都不硬写，也**没有任何「自带外观」开关**
（2026-09-19 按用户要求收口：「还是不要颜色了」）。

硬纪律（`tests/ui-css-scope.mjs` 的 C1–C6 逐条钉着）：

- 所有选择器都落在 `.wpr-*` 作用域内（没有裸元素选择器）；
- 颜色只走 `var(--dsw-alias-*, 兜底值)`，不写死色值；
- 不碰 `:root` / `html` / `body`，不定义、不覆盖任何 `--dsw-*` 宿主变量；
- 没有 `!important`。

目标：**装上它 + 任何第三方美化插件 = 互不干扰**。C7–C11 再把「不存在第二层」钉住：注入的 style 标签只有一个、
钩子里没有第二层的任何接口、源码里没有第二个标签名、配置里残留 `ui` 段也不会多注入任何样式。

token 名取自 DSH 前端产物实测（`dsh-client-ui-theme` 的 `body[data-ds-dark-theme]` 一段），
所以深色下卡片底色是 `--dsw-alias-bg-layer-1`、正文是 `--dsw-alias-label-primary`，与设置页其余部分同一套。
踩过的两个坑（都写成了机检断言）：① 主按钮的前景色必须取 `--dsw-alias-label-primary-foreground` —— 深色下 `brand-primary` 是**浅色**，不取它就会白底白字；② 老代码里写的 `--dsw-alias-text-1` / `-border-1` / `-bg-1` **在宿主里根本不存在**，兜底值永远生效，面板因此长不进宿主。

## 写配置的纪律（与本地编辑页同一套 `core/edit.js`）

- **只替换已知段**：`enabled` / `thinkingLanguage` / `persona` / `memory`；其余键（别的工具写在这个文件里的段）**原样保留**。
- **坏 JSON 拒写**：磁盘上现有文件不是合法 JSON 时返回 409，绝不覆盖用户数据；此时面板整块表单禁用并提示先手工修好。
- **只写一个文件**：定位链解析出的那一个 `config.json`；`POST` 必须是 `application/json`。
- 面板另提供「打开本地编辑器」按钮（编辑器没在跑时显示启动命令供复制）——本地页服务两个宿主，同一套逻辑。
- **不联网、不读工作目录**：宿主路由只读自己那一个 `config.json` 与收件箱。
- **只放行本机**：校验 Host 与 Origin 必须是 loopback，**刻意不绑定端口**（宿主 `--port` 可随时换）。

## 挂载（两个平面别搞混）

```yaml
# profile 的 cordis.patch.yml —— UI 插件必须在 profile 平面
- insert:
    - id: whale-persona-ui
      name: 'whale-persona-ui'
```

人设本体（`whale-persona`）必须在 **agent preset** 平面。
挂错平面的后果不是「插件失效」，而是整个插件树加载失败、DSH 起不来：
`prompt section "deployment:persona-prefix" is already registered`。
一条命令装（含两处挂载）用仓库根 `node scripts/install-dsh.mjs`。

## 宿主路由（面板的数据源）

`GET /whale-persona/api/summary?tier=flash|pro` → `{ ok, tier, model, lastModel, configPath, configState, configValid, enabled, thinkingLanguage, selfName, selfNameByModel, userName, contracts, memory, sections, warnings, tonePresets, raw, defaults, editor }`

`lastModel`（0.9.0 补丁）= **宿主最近一次真实注入用的模型 id**，来自 `core/lastModel.js` 的 `readLastModel()`（读配置目录下的 `last-model.json`）；没有记录时是空串（不报错，面板就不显示那行提示）。
前端拿它做两件事：① 在三张「按模型」卡的提示里显示出来；② 新建「按模型」条目时预填关键词（`client.js` 的 `addAt(..., seenModel)`）。
注意它和顶层的 `model` 不是一回事：`model` 是**查询参数**（面板当前按 flash/pro 哪一档渲染预览），`lastModel` 是宿主**实际传进来**的 id。

形象与语气（`persona.appearance` / `persona.tone`）**不单列顶层字段**：它们随 `raw`（磁盘原文，含按模型覆盖表）与 `defaults`（出厂形状）一起下发，
前端 `client.js` 的 `styleForm` 把两者抹平成表单形状（`appearanceEnabled / appearanceText / appearanceRows / appearanceKeep`，语气同）；
保存时 `styleOut` **先展开 `raw` 里的同名对象再覆盖这三个已知子键** —— 未知子键照旧原样保留（测试 N2 / N3 钉住）。
`tonePresets` 就是 `core/presets.js` 的 `TONE_PRESETS` 4 条（严肃 / 温柔 / 简洁 / 幽默），点一下填进「通用语气」输入框，填完可继续手改。

护栏：Host / Origin 必须 loopback，否则 403；未知路径 404；任何异常都回可读 JSON（面板坏掉不连累设置页）。

`GET /whale-persona/api/presets`（0.10.0 起）→ `{ ok, dir, configPath, presets, skipped }`。
`skipped`（0.11.0 新增）是**本次列目录时被跳过的文件**（`[{ file, reason: 'unrecognized-shape' | 'unreadable' }]`）：
预设读不出来时不再无声跳过 —— "格式不兼容"和"用户没建卡"必须能分辨，排查成本差在这里。

## 测试

```bash
node tests/ui-panel.mjs      # 宿主半身断言（读写路由、护栏、未知键保留、坏 JSON 拒写、换档、字段口径、形象/语气卡与预设下发；折叠默认收起 N6/N6b/N6c、基础层 CSS 纪律 N7/N7b、磁盘残留 ui 段不被裁 N8）
node tests/ui-css-scope.mjs  # 样式作用域门 C1–C6（只在 .wpr-* / 只用宿主变量 / 无 !important / 不碰 :root,html,body）+ C7–C11（不存在第二层样式与自带外观开关）
# 最后一行是**本机维护者专用**：夹具在 data/ 下（.gitignore 忽略、不入库），仓库读者拿不到它 —— 故标 paths-gate:exempt
node data/ui-design/preview-panel.mjs --state=filled --name=panel-after   # 静态预览出图（改版前后同机位对照用；paths-gate:exempt）
```

## 条件反射面板与只读路由（0.12.0）

第二个整页 `settings.section` id `whale-persona-reflex`（label「条件反射」，order 130）—— **只读**：列规则、命中台账、试命中。
路由：`GET /whale-persona/api/reflex/state`（状态快照）与 `GET /whale-persona/api/reflex/test?q=&tier=`（试命中，不写档位 = 跨档试）。
两条路由与既有 API 同栈、同 loopback 守卫；规则文件的**写**不在本包（由用户或 AI 改文件后跑 `scripts/reflex.mjs check`）。
