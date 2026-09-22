# 变更记录

> 版本号口径：根包与两个 sub 包（`adapters/dsh`、`adapters/dsh-ui`）**lockstep**，一起动。
> 每条改动都写**触发来源**与**验证方式** —— 与本仓 CONTRIBUTING 的纪律一致。

## v0.16.0（2026-09-22）

### 新增：`SPEC.md` —— 把 `whale-persona-preset/1` 公开成第三方可实现的格式契约

触发来源：2026-09-22 维护者问「接下来怎么让插件更通用、更低门槛」。三路外部调研（提示词注入生态 /
角色卡标准 / 记忆治理）合并出一个结论：本仓已有引擎、面板、18 个测试与安全探针，
**却没有一份"别人能照实现"的公开契约** —— `core/presetStore.js` 里定义了 `PRESET_SPEC` 常量，
仓库里却没有任何文档解释它。对标证据：`chara_card_v2` 规范本体仅 ★191 且 2023-06 停更，
却是跨生态事实标准 —— **规范的价值在被消费端，不在规范仓自己**。

- 规范内容：配置文件结构与定位链 / 注入文本装配契约（段落顺序、固定文案、占位符、bullet 规则）/
  预设卡格式与 `PERSONA_KEYS` 白名单 / 酒馆 v2·v3 双向映射与"不承接"清单 /
  收件箱只追加式事件日志与重放语义 / 分类路由 / 条件反射 / 「零行为改变」的可机器验证判据；
- 只发布**格式**：不含任何具体人设文本、私人配置或关系口径；
- 同时登记进 `package.json` 的 `files` 白名单，随包分发。

验证方式（2026-09-22 实跑）：

- §3.1／§3.2／§3.5 与 `node scripts/render-preview.mjs --config examples/demo-config.json`
  的真实输出**逐字核对一致**；
- §3.3 用临时收件箱实测（2 条 `proposed` + 1 条已确认）：注入块只含已确认的那条，
  两条候选均未进注入（`buildPersonaParts` 直调）；
- `npm test` 18 个测试文件全绿、`node scripts/prepublish-check.mjs` P2/P3/P4 全过（77 个文件）。

### 变更：README 首屏重写（先讲解决什么问题，再讲有什么能力）

触发来源：同上。原首屏第一屏是元信息（CI 徽章、维护状态、英文段）与能力表，
新读者看不到"这跟我有什么关系"。

- 新增「它解决什么问题」一节：痛点 → 一句话价值 → **零安装先看效果**的一条只读命令
  （`render-preview.mjs`，不碰用户任何配置）→ 指向 [SPEC.md](SPEC.md)；
- 修正 `仓库结构` 一节的过时数字：`tests/` 实为 **18** 个文件（原写 17）。

验证方式：内部锚点全部命中（README 2/2、SPEC 1/1，脚本核过）；
`node tests/paths.mjs` 6 项全过（155 条命令路径引用无死链）。

## v0.15.1（2026-09-22）

### 修复：README 示例路径命中发布闸门词表（0.15.0 已发出的包里也带着这行）

触发来源：2026-09-22 发布 0.15.0 之后的复盘 —— 用仓库外词表扫**已发布包的内容**、并本地重跑
`prepublish-check`，查出 `README.md:488` 的示例配置把一个落盘文件名起成了词表里的内部目录名，命中即红。

- 那是**虚构示例路径**、不含真人信息（P2 files 白名单、P3 个人配置类文件名两项均通过），
  但闸门判据只认机器结果，命中即红。
- README 示例改成中性名：`D:/notes/pitfalls.md` / `"## Pitfalls\n"`（`pitfall` 这个 sinks key 是 API，不动）。
- npm 版本不可删，0.15.0 只能靠本版覆盖；这行只影响示例可读性，不影响任何行为。

### 变更：词表拆「硬词 / 软词」两档 + 补上闸门的首选读取位置

触发来源：同上。泛词在公开文档里正常出现会必然误伤（同类教训：本机知识库里已经踩过一次）。

- 两个容易在公开文档里正常出现的泛词，从机器判据挪进词表注释区的「软词（需人工判断）」，
  发布前人工扫一眼即可；硬词保持 13 条（人名 / 称呼 / 私有工作目录 / 私有项目名）。
- 词表补上首选位置 `<repo>/data/prepublish-words.txt`（`data/` 在 gitignore、也不在 `files` 白名单）。
  之前词表只放 `$DSH_HOME/whale-persona/` 时，`DSH_HOME` 一变，四个候选位置一个都命不中，
  闸门会直接红在 P1（"词表没找到"）—— 这是实测出来的，不是推测。

### 修复：`tests/ui.mjs` 对真实 `DSH_HOME` 的隐式依赖

触发来源：同轮本地实跑 `npm test` 复现 —— 收件箱里只要有一条「待确认候选」，
`U2 无提醒（配的都生效）` 就红；CI 上干净 home 却全绿，属「本机红 CI 绿」那一类隐式环境依赖
（同类：0.15.0 修掉的 I6）。

- 该用例 spawn `scripts/ui.mjs` 时只隔离了 `DSH_WHALE_CONFIG`，`DSH_HOME` 仍继承真实环境，
  而 preview 会去读真机收件箱。现补上 `DSH_HOME: tmp`，与其余测试的环境隔离写法一致。

### 验证方式

- `node scripts/prepublish-check.mjs`（带词表、不加 `--no-words`）：P2/P3/P4 全绿，闸门通过。
- `npm test` 全绿（在收件箱含待确认候选的本机状态下）；`npm run sec` PASS（`fail:0 suspect:0`，4 条 manual 跳过）。

## v0.15.0（2026-09-22）

### 变更：包名去掉 scope（`@shenA2024/whale-persona` → `whale-persona`）

触发来源：2026-09-22 维护者拍板上 npm。npm 的包名校验**不接受大写字母**（读了本机 npm 的
`validate-npm-package-name`，第 68 行 `name.toLowerCase() !== name` 即对新包不合法；`npm view` 实测
直接报 `name can no longer contain capital letters`）。原包名的 scope 里有两个大写字母 —— 不上 npm 就没事，
一上就必须改。

- 根包 + `adapters/dsh` + `adapters/dsh-ui` 三处名字与版本一起动（lockstep）。
- `cordis.patch.yml` 的挂载行、安装脚本的两个包常量、`scripts/doctor.mjs`、`scripts/ui-row.mjs`
  与全部测试夹具同步改名。
- **老安装不受影响**：装过的包名留在各自的 `node_modules` 里，本仓改名弄不坏它们；关联仓
  `whale-persona-presets` 的引擎路径解析改成**新旧包名都认**。
- `CHANGELOG` 里的历史条目**保持原样**（历史就是历史，不改写）。

### 新增：npm 发布通道

触发来源：同上。用户反馈里呼声最高的是"装不动"；实测安装脚本本身**一次跑完**
（装包 + 建预设 + 挂面板 + 拷技能 + 自检），瓶颈在"必须先克隆仓库"这一步。

- `publishConfig.registry` 钉死 `https://registry.npmjs.org`（本机默认 registry 是只读镜像，防发错地方）。
- 发布清单新增 §5（npm），CI 增加一条结构判据。

### 新增：发布前闸门 `scripts/prepublish-check.mjs`

触发来源：2026-09-22 维护者要求「任何要公开的安装包，发布前必须检查有没有夹带私人内容」。

- 打**真包**（不是工作树）后判四件事：词表必须拿得到（拿不到就红，**绝不"没词表就当干净"**）、
  包内文件全在 `files` 白名单内、无个人配置类文件名、包内文本不命中私有词表。
- **词表不进仓**（否则扫描器自己就是泄漏源）：从 `data/prepublish-words.txt`（gitignore）
  或 `$DSH_HOME/whale-persona/prepublish-words.txt` 读。
- 命中只报「文件:行 + 词表第几条」，**不回显命中内容**（免得它被打进 CI 日志）。
- 写面登记进 `.github/SECURITY.md`（安全探针 S15 与代码同步）。

### 验证

- `npm test` → exit 0
- `npm run sec` → `PASS true` + `SELFTEST true`（含 S15 写面 15 个、未登记 0）
- `npm run prepublish-check` → 通过：76 个文件全在白名单内、无个人配置类文件名、词表 0 命中
- 关联仓 `whale-persona-presets` 的自检脚本（`check.mjs`，设 `WHALE_HARNESS=<本仓>` 跑）→ 16 张卡全过，exit 0

## v0.14.2（2026-09-21）

### 修复：docs/ 没随包分发，README 里的链接对 tarball 用户是死的

触发来源：2026-09-21 收口复查（维护者问"有没有缺东西没发布"）。README 两处指向
`docs/维护状态.md`（"取舍见…"），而 `package.json` 的 `files` 白名单没有 `docs` ——
按 **tarball**（本仓的主要分发通道）安装的人点那个链接就是死链；GitHub 上却是好的，
所以一直没被察觉。`qa/`、`examples/` 都在白名单里，`docs/` 漏了属不一致。

- `package.json`：`files` 加 `docs`（维护状态.md 是公开的取舍记录，随包分发无隐私问题，
  隐私门禁 S14 本来就覆盖它）。
- README 一键安装命令升到 v0.14.2（发布清单第 3 节：标签必须选本次版本号，选错 = 404）。

### 验证

```
npm test     # 18 套 exit 0
npm run sec  # PASS true（S14 隐私 + S15 写面 13/13）
npm pack --dry-run | Select-String docs   # 能看到 docs/维护状态.md 进包
```

## v0.14.1（2026-09-21）

### 修复：文档写面落后于代码（第三方走读发现）+ 新增 S15 写面同步门禁

触发来源：2026-09-21 维护者转来第三方走读报告（GLM5.3）。它指出 `.github/SECURITY.md` 仍写
"它写盘只有两处：config.json 与（只读的）记忆收件箱"，而 0.13.0 起实际写面已扩到
reflex 台账 / 沉降目标文件 / sink-log / last-model / session-flags —— 属文档漂移。同报告还指出
关联仓 `check.mjs` 的自检默认路径写死了维护者本机路径（S14 词表管不到"工具默认值"这类泄漏）。

- **`.github/SECURITY.md` 写面清单**（中文表格 + 英文段）：逐项登记 13 个会写盘的生产文件及其触发时机；
  同时改掉两处过时口径 —— 版本行（0.11.x → 0.14.x）、"设置面板也能确认记忆"（实际只有 CLI 一条路）。
- **新增探针 S15（SEC_WRITE）**：扫 `core/|adapters/|scripts/` 里出现写/删调用的文件，
  **任何一个没被 SECURITY.md 点名就红**。写这条时它当场抓出我自己漏登的两个：`core/edit.js`
  （面板/本地编辑器的保存路径）与 `scripts/sync-core.mjs`（重建 vendor 副本）—— 门禁第一天就抓到了真东西。
- **关联仓 `check.mjs`**：引擎路径改三级解析（`WHALE_HARNESS` 环境变量 → `--harness` 参数 →
  已安装插件的 `$DSH_HOME/profiles/*/node_modules/@shenA2024/whale-persona`），拿不到就明确报错不猜；
  公开仓里不再出现任何本机路径。

### 验证

```
npm test     # 18 套 exit 0
npm run sec  # PASS true {fail:0,suspect:0,skip:4}
             #   S15：会写盘的生产文件 13 个；未登记 无（加 S15 之前是 13/2 未登记，当场抓出）
node ../whale-persona-presets/check.mjs   # 内容包自检：16 张卡全过（引擎路径三级解析生效）
```

## v0.14.0（2026-09-21）

### 新增：共存体检 + 撞名不再炸树（回应「会不会和别的插件冲突」）

触发来源：2026-09-21 维护者转述有人担心「这个插件会不会和其他插件冲突」。
先把口径说清：与官方 `@deepseek-ai/dsh-persona` 的"冲突"是**设计目的**（我们占的就是那两个官方具名槽位，
靠跨层遮蔽让人设盖住部署级默认）。真会出事的是另外两件，本轮都处理掉：

- **段注册降级（`adapters/dsh/sections.js`）**：宿主对"同一平面已存在同名段"是硬错 —— 一抛整棵树起不来、
  用户看到的是 DSH 打不开。现在注册失败被吞掉并留一条 `console.warn`（附体检命令），**最多少一段，
  不是会话崩**；其它段照常注册，dispose 照常可用。与 core/ 一贯的"异常一律降级"同一口径。
- **`scripts/doctor.mjs` 共存体检**：只读磁盘事实，报四件事 —— 我们占了哪些名字；
  已装插件里还有谁声明同一批名字（**区分"已挂载"与"只是躺在 node_modules"**，只有前者才会真撞）；
  profile 里有没有重复 loader id；配置真源在哪。`--json` 机器可读，退出码非 0 = 有冲突级问题。
  扫描只读各包**入口文件**：真实工程里递归扫 node_modules 会直接超时（本机实测 >120 s），
  而"声明了同名段/命令"必定写在入口或其直接依赖里 —— 够用且快。
- README 新增「与其他插件共存（冲突怎么办）」：占位清单（段名/命令/loader id/preset/配置目录）+ 撞了怎么修。

### 验证

```
npm test     # 18 套 exit 0（新增 tests/conflict.mjs 10 项：撞名不抛、其余段照常、
             #  dispose 可用、警告可见；doctor 判据只扫入口不递归、能认出已挂载包名）
npm run sec  # PASS true（S14 隐私门禁：102 个跟踪文件零命中）
node scripts/doctor.mjs
             # 本机实测：无冲突级问题；另标出盘里躺着未挂载的 @dsh-external/dsh-whale-persona
             #（私有套件的前身，声明了 4 项同名段/命令 —— 没挂载就不影响运行，挂上去才会撞）
```

## v0.13.0（2026-09-20）

### 新增：把「AI 提议 → 人确认」的闸门推广到人设记忆之外（分类路由 / 沉降）

触发来源：2026-09-20 维护者问「下一步加什么功能、要不要学竞品」。核过同类后发现：竞品的差异集中在
**角色数量与跨平台**（agency-agents 153,680★ / 中文版 20,817★、20 个工具），而"提议—确认"这条代码级
闸门**没有对标**；但本插件这条闸门当时只服务人设记忆，维护者每天真正在做的沉淀（坑卡、思想回填、落位）
仍然只靠提示词里的君子协定——"别忘了写坑卡"这种话，恰恰是本插件存在的理由所要消灭的。

- 收件箱事实行新增可选 `kind`：缺省 `"memory"`（注入型，行为**逐字节不变**）；
  `kind` 非 memory 的条目（`pitfall` / `idea` / …）是**沉降型**——`readInjected` 只收 memory 类，
  即使已确认也**永不进提示词**（它们的去处是文件，不是每轮提示词）；
- `memory.sinks` 路由表：`{ "<kind>": { path, format?: "md"|"plain"|"jsonl", template?, header?, createParents? } }`，
  默认空表 = 零行为改变；模板占位符 `{text} {date} {kind} {tag} {source}`；
- **落盘只发生在人工确认这一刻**（`node scripts/memory.mjs confirm <序号>`）：先追加 confirm 行，
  再按路由**只追加式**写目标文件，成功后追加 drop 行（收件箱是队列，入库即出队）；
  幂等靠 `sink-log.jsonl`（同 kind + 同正文 + 同目标不重复写）；没有路由的 kind 会显式报出来（不静默吞掉）；
  写失败降级为报告（不抛、不半写）；kind 归一化只留 `[a-z0-9_-]`（防花样 kind 变成路径花样）；
- 【入库纪律】只在**配了路由**时追加「分类路由」一段（没配 = 一个字都不出现）。

### 新增：注入体积计量与预算（只提醒，永不自动裁剪）

触发来源：同一天的对照实测——本插件一直讲"省 token"，但改之前**没人看得见**自己的配置每轮注入多少。
维护者本机实测：合计 2,260 字符，其中人设正文 1,689（74.7%）、历史备忘 407、末尾段 37、思考语言 127。

- `core/measure.js`：计量走**与渲染同一条通路**（`buildPersonaParts` / `buildSuffix` / `buildThinkingLanguage`），
  不是另算一份近似值；`budget: { enabled: false, max: 0, warnInPrompt: true }` 默认关（装上零行为改变）；
- 超预算且 `warnInPrompt` 时，在末尾段注入一行提醒（让 AI 主动告知用户），`budget.note` 不计入 `total`（防自涨）；
- CLI `node scripts/inject-size.mjs`（`--tier/--model/--cwd/--capture/--json`），未指定模型时用
  `last-model.json` 里**上次会话真实用的 id**（界面显示名不是它）；
- 设置面板「实际注入的三段」卡头显示合计字符数，并多一个折叠块列出分段明细与预算状态（/summary 新增 `injection`、
  `sinks` 字段，只读）。

### 验证

```
npm test     # 17 套 exit 0（新增 tests/sink.mjs 28 项、tests/inject-size.mjs 17 项；
             #  tests/inbox.mjs 等 15 套老断言全绿 = 无 kind 的老行行为不变）
             # ui-panel 新增 P9d/P9e/P9f、N6d/N6e/N6f：面板给的合计 == 它下发那三段的实长之和
             # zcode-hook Z7：sync-core 后 vendor 副本与 core 一致
npm run sec  # PASS true fail=0 suspect=0 skip=4（新增 S13 SEC_SINK：
             #  分类条目永不进提示词 + 渲染路径零写盘副作用；同轮修掉 S8 靠 process.env
             #  定位的老毛病 —— 它是异步探针，同步探针插在它的 await 之间改 DSH_HOME 就会读串台）
node scripts/inject-size.mjs --cwd D:/work/demo
             # 实测一份实际配置：人设正文 1689 / 历史备忘 407 / 末尾段 37 / 思考语言 127 = 合计 2260 字符
node scripts/memory.mjs   # 状态台新增「沉降路由」「沉降日志」与逐条 kind 标注
```

## v0.12.4（2026-09-20）

### 修复：CI 连续 6 次红的根因 —— 路径门禁按「磁盘存在性」判，而不是「git 跟踪集」

触发来源：2026-09-20 维护者看到 GitHub Actions 上 CI 从 #19（0.12.1）起连续 6 次红，四个矩阵腿都卡在「功能测试」：
`FAIL P1 … [{"where":"adapters/dsh-ui/README.md:117","ref":"data/ui-design/preview-panel.mjs"}]`。

- 门禁自己有洞：判据是 `existsSync`，而 `data/` 被 `.gitignore` 忽略 —— 本机有那份夹具、干净 clone 没有，
  于是「本机绿 / CI 红」。改为按 **`git ls-files` 的跟踪集**判定（非 git 目录退回磁盘判据），
  并加 P3 断言钉住「判据确实走跟踪集」（`tracked>50`）；
- 被抓的那行是真漂移：`adapters/dsh-ui/README.md:117` 让读者跑一个 `data/` 下的本机夹具（仓库里没有），
  已标明「本机维护者专用」并加 `paths-gate:exempt`。

### 验证

```
改判据后**先在本机复现 CI 的失败**：FAIL P1 … README.md:117（与 CI 日志逐字一致，exit 1）
修好后：路径存在性 6 项全过（125 条引用 / tracked=95）；npm test 15 套 exit 0；npm run sec PASS true
CI：run #25 四条矩阵腿全绿（推完轮询到 completed 才认，不再只看本机）
```

## v0.12.3（2026-09-20）

### 安全：把「条件反射正则」的信任边界写成文档与提示（CodeQL 告警 #1 的处置）

触发来源：2026-09-20 GitHub Code scanning 报 `#1 js/regex-injection [high]` @ `scripts/reflex/new.mjs:70`
（原文 `This regular expression is constructed from a command-line argument`）。

判定：**不是注入面**。这条命令是用户在本机给自己建规则用的工具，正则由本人（或本人的 AI 代笔）写，
信任边界与规则文件 / `config.json` 完全一致（SECURITY.md 早已写明「能写到这两个文件的人，就能影响 AI 行为」）。
它真正指的是**自伤式 ReDoS**：灾难性回溯的形状会让该步匹配变慢（不抛错、不炸会话，但会卡）。
为了扫描器变绿去删掉那个编译校验，是拿真功能换安静 —— 不这么做。

- `scripts/reflex/new.mjs` 与 `adapters/dsh/reflex/match.js` 两处 `new RegExp` 旁边写清信任边界与处置依据；
- `scripts/reflex/check.mjs` 新增 `looksCatastrophic()`：建规则期对「嵌套量词 / 歧义分支套量词」给 WARN（只提示、不拦写盘）；
- `tests/reflex-rules.mjs` 新增 T6 两条断言钉住它（闸门 15 → 17 项）；
- `.github/SECURITY.md`「已知设计约束」补同类边界一条 + 英文段同步；
- 告警按「接受的边界」关闭（`won't fix`，备注含提交号与文档位置）。

### 验证

```
npm test     # 15 套 exit 0（reflex-rules 17 项、reflex 55 项、路径存在性 5 项）
npm run sec  # PASS true {"fail":0,"suspect":0,"skip":4}
实测：node scripts/reflex.mjs new --text '(a+)+$' --pos aaaa --neg bbb --yes → 输出含「灾难性回溯」且退出码 0（警告不拦）
告警复核：code-scanning/alerts?state=open → 0
```

## v0.12.2（2026-09-20）

### 隐私：公开仓脱敏（测试夹具与注释里的私人词汇），并把脱敏审计补进发布闸门

触发来源：2026-09-20 维护者问起本插件的初衷 → 回读本机一条纪律
（每次对外发布前重跑脱敏审计）时发现：**这条纪律在 v0.12.0 / v0.12.1 两次发布前都没执行**，
公开仓里带着本机私人取值 —— `tests/reflex.mjs` 的夹具直接用了本机真实配置（第 37/38/70/78/80/81/173/174 行）、
`scripts/reflex/new.mjs:7` 注释带私用称谓、`tests/model-names.mjs` 与本文件对应的 `core/render.js:10` 注释用本机自称做占位。

- 四处全部换中性占位（`甲档答复／乙档答复`、`甲档名／乙档名`、档位注释改为直接描述档位判定）；
  测试目的不变（按档位只注入一套、不串档；按模型选自称），回归条数不变；
- `core/render.js` 改后已跑 `node scripts/sync-core.mjs` 同步 vendor 副本（测试 Z7 校验）；
- 审计词表补齐（原词表只覆盖真名与模式名，漏了泛称谓）——**词表本身不写进公开仓**，只落本机私有位置；
- **已发布的 tag 不重写**（删不干净、且已公开），改为删除旧 tag 与旧 Release，公开面只保留本版；
- 私人文本仍留在 main 的历史提交里（GitHub 代码搜索不索引历史）；要彻底抹掉需重写历史，
  代价是全库引用的提交号集体悬空，故本次不做。

### 修复：ZCode vendor 副本的同步守卫漏文件（顺带补上陈旧的 edit.js）

- 跑 `node scripts/sync-core.mjs` 时发现 vendor 的 `edit.js` **陈旧了一个版本**（0.11.2 的「收件箱 N 行」口径修复没同步过去），
  而测试 Z7 一直绿灯 —— 它的比对清单**写死了 5 个文件**，`edit.js` 不在里面；
- Z7 改为**动态取 `core/` 下全部 `.js`** 逐个比对；反证：把 vendor 的 `capture.js` 改脏 → Z7 红（退出码 1），还原 → 绿；
- vendor 的 `edit.js` 已由 sync-core 补齐，随本版发布。

### 验证

```
git grep -E '<本机私有词表>'   # 4 处命中，全部是同一个模式名
npm test     # 15 套 exit 0（Z7 校验 vendor 副本已同步）
npm run sec  # PASS true {"fail":0,"suspect":0,"skip":4}
```

## v0.12.1（2026-09-20）

### 修复：把「文案里的路径与数量」变成机器判据（第三方评审走读查出的漂移）

触发来源：2026-09-20 维护者转来第三方 AI（GLM5.3）对 v0.12.0 的走读报告 —— 只读载荷里的提示让 AI 跑
一个不存在的命令 `tools/check.mjs`（本仓没有 `tools/` 目录）、`reflex/rules.js` 头注释把规则文件落点写成 `whale-suite/`、
两处 `spawnSync` 未显式写 `shell:false`。复核时又查出同类漂移：跑法注释写成旧文件名、示例与 README 里的落点、
以及「8 套测试 / 11 组探针」这类写死的数量口径（实际 15 套 / 12 组）。

- 三处路径与落点文案改成实际值；两处 `spawnSync` 补 `shell: false`（安全探针嫌疑项清零）；
- 新增门禁 `tests/paths.mjs`：扫生产面（`core/` `adapters/` `scripts/`）与文档面（`tests/` `qa/` `docs/` `examples/` `.github/` 与根三件文档），
  抽出 `node <路径>` 引用，按「文件所在目录 → 仓库根」两级解析后校验存在性，缺一个即失败并点名 `文件:行号`；
  自带 `--selftest`（种死引用必被抓、活引用必放过）；已接进 `npm test`（第 15 套）；
- `CONTRIBUTING.md` / `README.md` / `.github/workflows/ci.yml` / 探针头注释的数量口径同步；
- `package-lock.json` 的版本号从 0.9.1 补齐到本版（与根包 lockstep）；
- 取舍：`/reflex/state` 的 `hint` 字段**保留**（读该 JSON 的 AI 需要它），只把命令改对 —— 它现在也被新门禁盯着。

### 验证

```
npm test     # 15 套 exit 0（新增 tests/paths.mjs 5 项：自测 3 + P1 扫 121 条引用 + P2 扫描面非空）
npm run sec  # PASS true {"fail":0,"suspect":0,"skip":4}（0.12.0 时 suspect:1）；--selftest 仍抓 6 类违规
反证：把 state.js 文案改回旧值 → node tests/paths.mjs exit 1 并点名 adapters/dsh/reflex/state.js:114；还原后 exit 0
```

（本版不发 npm：发布通道仍是 GitHub Release 附件。）

## v0.12.0（2026-09-20）

### 新能力：条件反射层（reflex）并入本插件

触发来源：2026-09-20 维护者决定「条件反射本质上属于人设插件」——把原先独立开发的这一层并进本仓，
让它随人设插件一起公开；并明确**只公开本仓**，其余配套项目保持私有。

**它是什么**：用户自己写规则，命中规则时由插件**在代码层**给会话追加一条极短指令，让模型当步直答；
匹配是纯代码（正则 / 归一化子串 / 词袋），**不调模型、不花 token**。

- 新模块 `adapters/dsh/reflex/`（`index.js` / `match.js` / `rules.js` / `state.js` / `toolnarrow.js` / `log.js`），
  由 `adapters/dsh/index.js` 装配；**零宿主依赖**（连注入消息都按宿主校验器要求自己造形状，不 import 宿主包）。
- 规则文件 `$DSH_HOME/whale-persona/reflex.json`（早期布局 `whale-suite/` 沿用；`DSH_REFLEX_RULES` / `DSH_REFLEX_OFF` 可用）；
  出厂**空规则**，仓库里只有不含个人内容的示例 `examples/reflex.example.json`。
- 设置面板新增第二个整页「条件反射」（`settings.section` id `whale-persona-reflex`）：只读列规则 / 台账 / 试命中；
  路由 `GET /whale-persona/api/reflex/state`、`GET /whale-persona/api/reflex/test`（只读、仅 loopback）。
- 命令行 `node scripts/reflex.mjs <show|check|new>`：体检闸门（退出码 0 才算交付）、
  建规则（先正反例试算，加 `--yes` 才写盘，**体检不过自动回滚**）。
- 省 token 三件事：命中那一步的请求瘦身（**只在压得动推理时才压输出额度**）、
  可选的**步级工具裁剪**（`then.tools` ＋ `toolNarrowing`，两步门、一步一裁、台账记 `savedChars`）。
- 新增回归：`tests/reflex.mjs`（55 项行为）＋ `tests/reflex-rules.mjs`（15 项建规则闸门）。

### 验证

```
npm test     # 14 套 exit 0（新增 tests/reflex.mjs 55 条、tests/reflex-rules.mjs 15 条）
```

（本版不发 npm：发布通道与节奏仍由维护者按需决定。）

## v0.11.4（2026-09-19）

### 改进（设置面板与本地编辑器：一轮可用性打磨）

触发来源：2026-09-19「拉起一个全新的 DSH home 装上本插件，请外部 AI 评审界面，按意见改」——
连续五轮评审 + 每轮回代码核查后落地。核查中判为误判的意见（工具栏吸顶、刷新确认其实早已实现）**未按其改动**。

**设置面板**（`adapters/dsh-ui/client.js`、`adapters/dsh-ui/index.js`）

- **首屏还给高频项**：人设预设整组下沉到面板末尾（原来排第 2 位，把称呼/立场挤出首屏）；
  「存为预设 / 导入」两张表单默认折叠，预设列表行保持常显。
- **三段预览**：卡头加「全部展开 / 全部收起」；正文框 `max-height` 280→520px
  （实测 376 字符的前缀原来会被框内滚动裁掉，看起来像"契约条目丢了"）。
- **收件箱计数口径统一**：横幅「收件箱 N 行里有 K 条待确认候选」与记忆卡「收件箱 N 行 · 待确认 K 条」
  同源同词（宿主 payload 新增 `inboxPending`，面板 `normalize()` 同步映射——这层是显式字段白名单，漏了就静默丢字段）。
- **勾上开关就展开**：形象/语气子卡在开关「关 → 开」的跃迁上自动展开；载入时保持收起（已配好的卡不占半屏）。
- 其余：行尾注缩短为「按模型 N 条」/「无覆盖」并在展开态隐藏；说明文字降一级（副文本 11.5px / 说明 11px）；
  预设行按钮分级（应用=主按钮、导出=描边、删除=错误色）；`opt-in` 一律改「出厂默认关」；状态不再由副题重复表达；
  「立场正文」占位符写明真实渲染规则（两段都在就都注入）；`persona.enabled=false` 且总开关开着时，
  状态条出一枚「人设段关」徽标。

**本地编辑器页**（`scripts/ui.html`、`scripts/ui.mjs`）

- 「收口纪律」→「入库纪律」（与 core 的用词一致）；二级开关从「称呼与自称」卡挪到顶部与总开关同组，
  改名「注入人设段」；右栏预览行改「预览时计入入库纪律」；`{{cwd}}` 统一用 `<当前工作目录>` 占位
  （原来用编辑器自己的 `process.cwd()`，与会话工作目录无关、纯误导）；删除按钮「删」→「删除」。

### 验证

```
npm test     # 12 套 exit 0（install-contract 20 条；ui-panel 新增 N11/N12 共 5 条断言）
npm run sec  # PASS true {"fail":0,"suspect":0,"skip":4}；--selftest 仍能抓出 6 类
```

界面改动用同一把尺子（`data/ui-design/preview-panel.mjs`，同尺寸 1000×2200）出前后对照，
并在真实宿主里实测两条新行为：点「全部展开」→ 三段正文齐渲染；`persona.enabled=false` → 「人设段关」徽标出现。

## v0.11.3（2026-09-19）

### 修复

- **tarball 通道装完，安装脚本静默什么都不做（退出码 0）**。0.11.2 为了让测试能 import 判定函数，
  在 `scripts/install-dsh.mjs` 末尾加了「拿 `process.argv[1]` 与 `import.meta.url` 比字符串」判断自己
  是不是入口。而 pnpm 把包装进 `node_modules/.pnpm/...` 再 **junction** 到
  `node_modules/@shenA2024/whale-persona`：`argv[1]` 是 junction 路径、`import.meta.url` 是 realpath，
  比较不相等 → `main()` 一次都没跑。现象是「命令成功、日志空白、没有人设、没有面板」。
  修法不是把比较写对，而是**取消入口判定**：纯判定拆到 `scripts/ui-row.mjs`，安装脚本无条件执行。
  触发来源：2026-09-19 发布 v0.11.2 后按 README 的 tarball 通道在全新 `DSH_HOME` 上复验 —— 装完发现
  `settings.yaml` 里没有 `agent-presets.default`、也没有 `.agent-presets/whale-persona`。
  验证：`tests/install-contract.mjs` 新增 I5（真 symlink 把整仓链过去跑一次，断言日志与退出码）；
  另把 tarball 通道整套重跑一遍（装包 → 跑安装脚本 → `--dump-config` 里该行恰好 1 条 →
  `dsh web` 起得来 → 面板 API 返 200）。
- **发布清单补一条**（`CONTRIBUTING.md` §2）：改过安装脚本必须**从 Release 下载的包里**跑一次，
  不能只跑仓库里的 —— 这两条路径在 pnpm 眼里不是同一条（仓库直跑没有 junction）。

## v0.11.2（2026-09-19）

### 修复

- **干净 home 上装完起不来：`duplicate loader entry id: whale-persona-ui`**（`scripts/install-dsh.mjs`）。
  0.11.1 给本包加了 `dsh.bundle.patch` 之后，宿主 `dsh plugin add` 会把本包自动追加进 profile 的
  `dsh.profile.bundles`，而那个 bundle 的补丁里已经插了设置面板行；安装脚本仍按老办法"往 profile 的
  `cordis.patch.yml` 里手工插一条"，于是同一个 id 被两个层各插一次 —— loader 的 entry id 全局唯一，
  重复即硬错，**整个插件树加载失败、DSH 起不来**（面板没了，整个人设也没了）。
  现在脚本先算清这条行的归属：bundle 已经挂了就一条都不插；重装还会把 0.11.1 写坏的那条摘掉（自愈）。
  触发来源：2026-09-19 「拉起一个全新 DSH home（全官方默认）+ 装本插件」—— 在全新 `DSH_HOME` 首次启动即复现。
  验证：`tests/install-contract.mjs` 新增 I4（11 条断言：bundle 已挂时不插 / 写坏的能摘回 / 别的 insert
  不误伤 / 双向幂等）；空 home 实测两遍：装完 `--dump-config` 里该行恰好 1 条、`dsh web` 起得来、
  `GET /whale-persona/api/summary` 返 200；把 0.11.1 写坏的文件放回 profile 再重装，脚本打
  「摘掉 profile 层的手工重复行」并把文件还原成 `[]`，服务照常起。
- **自愈路径不能留下两个 `[]`**（同轮返工）：摘完重复行若文件里还留着空列表占位行，就会写成两个 YAML
  文档，`--dump-config` 直接抛 `YAMLException: end of the stream or a document separator is expected`
  —— 比原来的重复 id 更难查。现在补行与摘行两条路都先收敛掉所有空列表占位行，最后只补一份。
  验证：I4 的后四条（自愈后只剩一个空列表 / 补行时同样收敛 / 空文件也能长出合法内容）。

### 验证

```
npm test     # 12 套，exit 0（install-contract 从 7 条断言涨到 18 条）
npm run sec  # PASS true {"fail":0,"suspect":0,"skip":4}；--selftest 仍能抓出 6 类
```

## v0.11.1（2026-09-19）

### 修复

- **声明 `dsh.bundle.patch`，让 `dsh plugin add` 装完就生效**（`package.json` + 新增 `cordis.patch.yml`）。
  此前包没有这个声明，宿主会打一句
  `warning: declares no dsh.bundle — installed as a plain dependency, not a profile layer`，
  然后把包**只塞进 profile 的 dependencies 就完事** —— 用户装完是"躺在 node_modules 里但不生效"，
  必须手工改 profile 的 `cordis.patch.yml` 才看得见面板。
  触发来源：2026-09-19 空 profile 实测（本地 HTTP 服务器当替身跑 `dsh plugin add`）。
  修完实测（同一个夹具）：`dsh.profile.bundles` 自动多出 `@shenA2024/whale-persona`。
  验证：新增 `tests/install-contract.mjs`（I1 声明与文件存在、I2 只挂面板不挂人设本体、I3 入口与零依赖）。
- 包白名单（`files`）补上 `cordis.patch.yml` 与 `CHANGELOG.md` —— 声明了却打不进 tarball 等于没声明。

### 口径说明

本包自动挂的**只有设置面板**；人设本体仍由 agent preset（或家目录层的 ``./global`` 入口）挂载，
这样"鲸鱼模式专属"的现状不变。理由写在 `cordis.patch.yml` 文件头。

## v0.11.0（2026-09-19）

### 修复

- **本地配置编辑器补 Origin 校验**（`scripts/ui.mjs`）：原来只查 `Host`，于是 `Origin: https://evil.example` 的 `POST /api/save` 也返 200 并覆盖 `config.json`。现在 `Origin` 头只要出现就必须是 loopback，非 loopback 一律 403；Host 判定拆成 `hostGuard` 便于单测。
  触发来源：2026-09-19 第三方复核指出该缺口。验证：`tests/ui.mjs` U4b（外源 403 且没写脏 / 自家与裸客户端 200）。
- **酒馆卡 `system_prompt` 不再静默丢契约**（`core/tavernCard.js`）：整段无换行且单行超长时，先按句末标点（`。！？!?`）与分号兜底断句；仍断不出可执行的行时，**不写 `contracts`、也不在映射报告里留"已承接"的记录**，转 `unmapped` 点名要人工拆分。
  触发来源：同上（原实现既丢光又报告成功）。验证：`tests/tavern.mjs` T4/T5。
- **预设列表不再静默过滤**（`core/presetStore.js` + `adapters/dsh-ui`）：`listPresets()` 记录被跳过的文件，面板 `/presets` 回一个新字段 `skipped`。
  触发来源：跨仓排查时发现"格式不兼容"会被伪装成"用户没建卡"。验证：`core/presetStore.js` `skippedPresets()`。

### 安全门禁

- **新增 S12 行为探针**（`qa/probes/probe-security.js`）：真起本地页，打三条请求断言"外源 Origin 403 / 无 Origin 200 / 自家 Origin 200"。
- **S7 收窄**：原来对本地页做的是形态匹配 `/origin/.test(ui)`，注释里出现该词就放行 —— 上一班因此漏报。现在只认"面板 `guard(req)` 真在 + 真读 host/origin 头"，本地页交给 S12 的行为测试。
- **自测有牙**：`--selftest` 的假根里种一个不做 Origin 校验的本地页，断言 S12 会 FAIL；实测 `SELFTEST true caught=[S1,S2,S6,S7,S10,S12]`。
- 台账新增 `qa/security-审查.md` §3（sec-2 班次记录）。

### 文档

- 新增"与 DSH agent team / 子代理的互操作"与"组一支 AI 工作室"两节，以及"已知边界"。

### 验证

```
npm test     # 11 套功能测试全过（新增 U4b / T4 / T5）
npm run sec  # PASS true {"fail":0,"suspect":0,"skip":4}；12 组探针 + 自测
```

## v0.10.0（2026-09-19）

- 人设预设库（可切换 / 可分享的人格文件）+ 酒馆（SillyTavern）角色卡 v1/v2 JSON 导入导出；不承接的字段在报告里点名。
- 细节见 README「人设预设与酒馆卡（0.10.0）」与`git log`。
