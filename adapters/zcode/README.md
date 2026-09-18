# whale-persona —— ZCode 适配器

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
   给 `persona.character` 填一句可识别的话（如「测试：人设已注入」）；
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
