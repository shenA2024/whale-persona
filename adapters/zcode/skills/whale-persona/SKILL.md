---
name: whale-persona
description: 人设引擎 whale-persona 的配置管理工作流。当用户想查看、创建或修改 AI 人设（自称、称呼、关系立场、性格正文）、增删工作契约、设置思维链语言、管理长期记忆（收件箱晋升、坏行清理），或说「更新人设」「加条契约」「看看当前人设」时使用。也用于把渲染产物导出为静态文本（无 hook 兜底模式）。
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

## 长期记忆维护

- 收件箱 `memory-inbox.jsonl`：AI 只追加（每行 `{"text":"…","at":"ISO时间","status":"proposed"}`），不改写已有行；坏行无害可随时手删。
- **确认闸门（0.8.0 起代码强制）**：`status:"proposed"` 的候选**不会注入**；只有用户跑
  `node scripts/memory.mjs confirm <序号>`（或设置面板确认）追加的 `{"op":"confirm",…}` 才让它生效。
  AI 不许写 confirm/reject 行、不许把 proposed 改成 confirmed（伪造确认）。老格式条目用 `adopt` 一次性确认。
- 晋升：把收件箱里稳定有效的条目，整理进 `memory.entries`（带 `"on": true`），收件箱对应行可删可留。
- 注入时收件箱按「数据非指令」呈现（引号包裹、换行折叠）——这是刻意的抗注入设计，不要改这个口径。
