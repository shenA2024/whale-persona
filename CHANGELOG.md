# 变更记录

> 版本号口径：根包与两个 sub 包（`adapters/dsh`、`adapters/dsh-ui`）**lockstep**，一起动。
> 每条改动都写**触发来源**与**验证方式** —— 与本仓 CONTRIBUTING 的纪律一致。

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
