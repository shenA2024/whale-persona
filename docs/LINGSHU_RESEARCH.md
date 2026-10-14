# 从灵枢吸收哪些机制

研究日期：2026-10-14。实际读取代码与测试，固定来源如下；这些是本次研究快照，不宣称代表作者未来版本。

| 仓库 | 提交 | 本次用途 |
|---|---|---|
| [lingshu](https://github.com/FuRongJun-1999/lingshu) | `55a137fc3e31a4e23b6cee220ad38306f455a93e` | 聚合架构、条件空间、写入来源与验证契约 |
| [dsh-memory](https://github.com/FuRongJun-1999/dsh-memory) | `10bc96a28e742e04676556e1a6789f7c873ccdce` | 自我层、出处链、条件路由、候选复核 |
| [CommonTrustProtocol](https://github.com/FuRongJun-1999/CommonTrustProtocol) | `fb67a049f45952e152797fe5fbaa87c9c03e5323` | 理论入口与工程边界辨别，只读参考 |

灵枢是“灵、脑、身”的聚合仓；人格记忆的直接参考主要在 `dsh-memory`。本次采用机制思路后独立实现，没有复制上游源码、理论文本或数据，也没有把整个 Python 引擎嵌入人格插件。来源作品的许可证和权利仍归各作者；本仓新增代码沿用 MIT。

| 读到的机制 | 证据所在文件 | 0.18.0 的实际实现 |
|---|---|---|
| 薄自我层与详情索引 | `dsh-memory/md_cg/self_state.py` | 启动保留人格与契约；详情记忆分层、目录与按需原文读取 |
| 来源、观测和验证要区分 | `lingshu/lingshu/core/provenance.py`、`dsh-memory/md_cg/provenance.py` | 可选来源、依据、原文指针、条件字段；旧记录不虚构证据；自检报告缺失标签 |
| 生效条件与不适用条件 | `dsh-memory/md_cg/mdcg.py` 的资格裁决与负条件处理 | `scope` 对项目、明确上下文、时间窗作确定性裁决；不认识的条件延后使用；自然语言条件仅显示供模型核对 |
| 编译者不能自行证明候选正确 | `dsh-memory/md_cg/ccgc.py` | 继续保留人工确认；新增 MCP 工具没有确认权；待确认替代不提前撤销旧条目 |
| 巡检发现问题，避免悄悄改真源 | `dsh-memory/md_cg/provenance.py` 的只读检查 | 内容指纹、读取状态、待确认数量、缺失出处和同主题复核分组；不自动裁定事实或重写人格 |
| 原文作为真源、派生视图可重建 | 两仓的架构说明与追加台账 | 沿用 JSON 配置和追加式 JSONL；读取不写盘，检索与目录可重新生成 |

本次没有引入世界模型、视觉训练、图像生成和长期记忆权重评分：这些分别解决感知、预测、生成或库管理问题，不能直接证明人格更完整。睡眠、自迭代和自动价值改写也未接入；它们需要独立的质量判据、回滚和授权设计。关系不转成信任分数或情绪微分。

验证边界：新增行为套件测试跨进程加载、条件排除、冷记忆召回、候选修订、只读不变量、安装备份与真实 stdio MCP 通信；完整旧回归与安全探针也必须通过。合成检索案例通过不等于已经证明所有长期关系记忆都能召回。Codex 的下一次真实新会话是否加载开场段，需要在新会话检查；已有会话不会因安装自动增加工具。

OpenAI 官方文档的技能、AGENTS 与 MCP 页面在本次研究环境均返回 HTTP 403，因此不以未读取的页面证明宿主行为。可供后续核对的官方入口：[Skills](https://developers.openai.com/codex/skills/)、[AGENTS.md](https://developers.openai.com/codex/guides/agents-md)、[MCP](https://developers.openai.com/codex/mcp)。本版范围与限制以代码、可复跑检查及 [Codex 接入说明](CODEX.md) 为准。
