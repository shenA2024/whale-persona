# 变更记录

> 版本号口径：根包与两个 sub 包（`adapters/dsh`、`adapters/dsh-ui`）**lockstep**，一起动。
> 每条改动都写**触发来源**与**验证方式** —— 与本仓 CONTRIBUTING 的纪律一致。

## v0.12.2（2026-09-20）

### 隐私：公开仓脱敏（测试夹具与注释里的私人词汇），并把脱敏审计补进发布闸门

触发来源：2026-09-20 维护者问「你知道我做这个人设插件的初衷吗」→ 回读本机《领域纲领／人设》第 3 条纪律
（每次对外发布前重跑脱敏审计）时发现：**这条纪律在 v0.12.0 / v0.12.1 两次发布前都没执行**，
公开仓里带着本机私人词汇 —— `tests/reflex.mjs` 的夹具直接用了本机真实关系口径（第 37/38/70/78/80/81/173/174 行）、
`scripts/reflex/new.mjs:7` 注释带私人称呼、`tests/model-names.mjs` 与本文件对应的 `core/render.js:10` 注释用本机自称做占位。

- 四处全部换中性占位（`甲档答复／乙档答复`、`甲档名／乙档名`、档位注释改为直接描述档位判定）；
  测试目的不变（按档位只注入一套、不串档；按模型选自称），回归条数不变；
- `core/render.js` 改后已跑 `node scripts/sync-core.mjs` 同步 vendor 副本（测试 Z7 校验）；
- 审计词表补上 `<relationship>|<relationship>`（原词表只有 `<maintainer>|鲸鱼|<relationship>|<relationship>|<relationship>|<private-repo>`，漏了这两个泛称谓）；
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
git grep -E '<maintainer>|鲸鱼|<relationship>|<relationship>|<relationship>|<relationship>|<relationship>|<private-repo>|<user>'   # 4 处命中，全部是「鲸鱼模式」这一模式名
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
