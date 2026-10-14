# Codex 人格与连续性 / Persona continuity

0.18.0 新增独立的 Codex 接入。Node ≥ 20，无运行时依赖，无模型 API 调用。默认使用独立私有配置，不会读取 `~/.dsh` 的人格和记忆。

```powershell
git clone https://github.com/shenA2024/whale-persona.git
cd whale-persona
node scripts/install-codex.mjs --dry-run
node scripts/install-codex.mjs
```

默认配置：`$CODEX_HOME/whale-persona/config.json`，未设置 `CODEX_HOME` 时为 `~/.codex/whale-persona/config.json`。首次安装是空白的，记忆关闭。填入自己的 `persona.character`、称呼和契约后，重启 Codex 并新开会话。人格来自你自己的选择。

已有配置可直接指定，安装不会改写它：

```powershell
node scripts/install-codex.mjs --config 'D:/private-persona/config.json' --dry-run
node scripts/install-codex.mjs --config 'D:/private-persona/config.json'
node scripts/continuity.mjs status --config 'D:/private-persona/config.json'
node scripts/continuity.mjs context --config 'D:/private-persona/config.json' --cwd 'D:/work/demo' --context work
node scripts/continuity.mjs search --config 'D:/private-persona/config.json' --cwd 'D:/work/demo' --query '动画流畅'
```

安装写入三处：Codex `config.toml` 的 `whale_persona` MCP 项、全局 `AGENTS.md` 的带标记开场读取段、`skills/whale-persona` 管理技能与路径定位文件。原有文件先备份为 `.bak-whale-*`，重复安装不重复插入；遇到 `AGENTS.override.md` 或未由本安装器管理的同名技能会停下来，避免遮蔽用户自己的指令。可用 `--codex-home` 指定另一套 Codex 目录。安装包所在目录必须保留；移动后重新安装即可更新路径。

MCP 初始化提供读取指引；开场段要求在首次回复、压缩恢复和身份修改后调用只读工具或本地读取器。它是一套可检查的加载链路，不保证宿主永远挂载服务或模型百分之百遵循指令。项目或组织指令可以覆盖全局指令；宿主关闭 MCP、指令被裁剪、文件失效时，需要检查 `status`。配置破损会返回 `unavailable`，不会把旧身份伪装成当前结果。

四个 MCP 工具全部只读：`whale_persona_context`、`whale_persona_status`、`whale_persona_memory_search`、`whale_persona_memory_read`。工具调用可传当前 `model`、`cwd`、`context`，安装不固定模型身份。服务支持 MCP `2024-11-05`、`2025-03-26`、`2025-06-18` 的 stdio 子集（initialize / ping / tools），不实现 OAuth、远端 HTTP、订阅或写工具。

上下文保留人格、契约、适用的手工记忆和核心记录；普通记录最多选 8 条，未展开目录最多 60 条。核心记录不参与名额竞争，但仍受适用条件约束。冷记忆按需搜索或用目录里的内容指纹 id 读取全文；原文修订后旧 id 失效，避免序号漂移读错。中文双字 / 英文词检索是确定性词面匹配，会漏掉无共同词面的改写。

新证据字段和条件见 [格式规范](../SPEC.md#14-连续性与证据扩展0180)。旧记录的缺失出处会在自检中标出来，不自动补成“用户亲口说过”。同一 `topic` 下出现不同文本只产生待复核分组，不能证明两者矛盾。候选仍需用户确认；MCP 没有确认、改人格或写记忆工具。共享文件权限仍可绕过人工确认纪律，不能把它称为操作系统权限隔离。

公开发布的是引擎。自己的配置、形象、对话、记忆、密钥、`runtime.json` 和备份保存在私有目录，不提交给公共仓库。

## English

Run the four installation commands above, fill your own persona in the generated private config, then restart Codex and open a new chat. `--config` selects an existing private config without rewriting it; `--codex-home` selects a separate Codex home. The installer backs up changes, preserves unrelated MCP entries, and is idempotent. Keep the installed source directory; reinstall after moving it.

The startup pointer in global `AGENTS.md`, four read-only MCP tools, and a local CLI reader provide recoverable continuity. Host loading and model compliance are not guaranteed; check `status` and use the CLI fallback when tools are unavailable. A malformed config fails explicitly rather than returning a stale persona. The MCP stdio implementation supports initialize, ping, and tools on the three versions listed above. No API key or network is required.

Identity and agreements stay in the private config. Confirmed memories carry optional source and applicability fields, content-bound read ids, and a review report. Core rows remain resident when applicable; cold rows can be searched on demand. Lexical retrieval can miss paraphrases. Model changes do not establish subjective continuity. Pending revisions retain the confirmed original until approval. Human confirmation is a workflow boundary, not protection from a model with arbitrary write access to the same files.
