# whale-persona —— DSH 设置面板（只读）

把「人设引擎此刻**实际会注入什么**」端到设置页，让用户看得见，不必问 AI。

```
设置 › 人设                                                          [打开配置文件] [刷新]
人设 · whale-persona                                    [flash 档][pro 档]
只读面板：这里显示的就是此刻真会注入系统提示词的那几段，跟运行期同一套渲染。
┌ 状态        已启用 · flash档: deepseek-v4-flash
│ 思维链语言  zh-CN
│ 称呼        自称「测试助手」· 称呼「新用户」
│ 配置文件    /home/you/.dsh/whale-persona/config.json        [复制路径]
└
实际注入的三段
  · prefix  （人设段 · 遮蔽部署级默认）              98 字符
      新用户的搭档，直来直去。
      你是测试助手，新用户的编程搭档：把事办成为止。
      工作契约：- 结论先行，默认精简。 - 结论必须有证据。
  · thinking（思维链语言段 · whale:thinking-language）  122 字符
  · suffix  （后缀段 · 部署级默认）                  …
```

## 它显示什么

| 区块 | 内容 |
|---|---|
| 状态 | 启用/停用、思维链语言、配置文件路径（可复制） |
| 称呼 | 自称（flash/pro 两档）、对你（用户）的称呼 |
| 实际注入的三段 | `deployment:persona-prefix` / `whale:thinking-language` / `deployment:persona-suffix` 的**全文**，可按 flash/pro 档切换 |
| 工作契约 | 逐条列出，关掉的显示删除线 +「已关，不注入」 |
| 长期记忆 | 开关、收口模式、手工条数、收件箱条数与最近 5 条（按**数据**呈现） |

三段的文本来自仓库根 `core/`——与运行期注入**同一套渲染代码**，不是面板自己拼的近似值。

## 边界（为什么是只读）

- **不写配置**：写仍然只有两条路——本地编辑器（`node scripts/ui.mjs`）或让 AI 改（技能代写）。
  面板只提供「打开本地编辑器」按钮（编辑器没在跑时显示启动命令供复制）。
- **不联网、不读工作目录**：宿主路由只读自己那一个 `config.json` 与收件箱。
- **只放行本机**：校验 Host 与 Origin 必须是 loopback，**刻意不绑定端口**（宿主 `--port` 可随时换）。

## 挂载（两个平面别搞混）

```yaml
# profile 的 cordis.patch.yml —— UI 插件必须在 profile 平面
- insert:
    - id: whale-persona-ui
      name: '@shenA2024/whale-persona-ui'
```

人设本体（`@shenA2024/whale-persona`）必须在 **agent preset** 平面。
挂错平面的后果不是「插件失效」，而是整个插件树加载失败、DSH 起不来：
`prompt section "deployment:persona-prefix" is already registered`。
一条命令装（含两处挂载）用仓库根 `node scripts/install-dsh.mjs`。

## 宿主路由（面板的数据源）

`GET /whale-persona/api/summary?tier=flash|pro` → `{ ok, tier, model, configPath, configState, enabled, thinkingLanguage, selfName, userName, contracts, memory, sections, editor }`

护栏：Host / Origin 必须 loopback，否则 403；未知路径 404；任何异常都回可读 JSON（面板坏掉不连累设置页）。

## 测试

```bash
node tests/ui-panel.mjs     # 宿主半身 15 项断言（路由、护栏、只读、换档、字段口径）
```
