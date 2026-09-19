# 安全审查台账（sec）

> 形态对齐一套既有的安全审查部门流程：**探针脚本 + 人工台账 + 每班结论与交接点**。
> 触发来源：仓库维护者 2026-09-19 要求做一轮安全审查，并留下可复现的门禁。
> 边界：**探针 PASS ≠ 门禁通过** —— 门禁以本台账全项人工核验为准。

## 审查记录

| 日期 | 班次 | 对象 | 结论 |
|---|---|---|---|
| 2026-09-18 | 第三方扫描（外部工具） | v0.8.0 / 0.8.1 | CodeGuard 与 GitHub CodeQL 的告警已全部处置，明细见 README「第三方扫描结果与处置（2026-09-18）」 |
| 2026-09-19 | **sec-1（首班，本仓自建）** | v0.9.1 @ `21f44b2` | 探针 11/11 通过（自测通过）；人工复核 4 项已带过；**无新增阻塞项** |

## §2 脱敏复核（2026-09-19，sec-1 附班）

本轮建探针后顺手做了一次「公开仓是否夹带私人内容」的全量复核，结论与处置：

| 面 | 结果 | 处置 |
|---|---|---|
| 真实凭据（`gho_` / `ghp_` / `github_pat_` / `sk-` / `AKIA` / `PRIVATE KEY`） | 当前树与全历史 **零命中**（命中的只是探针自己的正则与本文档字样） | 无需动作 |
| 本机用户名 / 绝对路径（`C:\Users\<user>`、`D:\<私有目录>`） | 当前树零命中 | 无需动作 |
| 作者真名与内部产品线目录名 | 当前树里仅出现在**本轮新增**的注释与本文档抬头 | **已改为中性表述**（见本提交）；历史提交里的同类残留见下 |
| 提交者身份 | 历史里有非 noreply 的本机身份；本轮提交一律 `shenA2024 <…@users.noreply.github.com>` | 历史身份需重写才能清；见下 |
| `data/`（演示 home、宣传截图、含真实配置的演示数据） | **从未被提交**，`.gitignore` 挡住 | 无需动作 |

**历史残留**：本仓 2026-09-18 做过一轮脱敏（脚本与夹具改示例名、路径改通用写法），但按当时的决定**没有重写历史**，
所以 `git log -p` 仍能读到早期提交里的真名与私有目录名。这些是**文本层面的历史残留，不含任何凭据**；
要不要重写历史（会改变全部 commit SHA、需临时撤掉 main 的 force-push 保护、已存在的 fork 会分叉）由维护者拍板。

## §1 sec-1（2026-09-19）

### 1.1 审查对象

- 版本 **v0.9.1**，commit `21f44b2`（本轮 UI 修复 + 版本一致性同步 + 本台账与探针）
- 面：`core/` 渲染核心 · `adapters/dsh-ui` 设置面板（宿主路由 + 浏览器半身）· `adapters/dsh` · `adapters/zcode`（冻结）· `scripts/`（安装器 / 本地编辑器 / 记忆台）
- 方法：本仓自建探针（可复现、只读、不联网）+ 人工核验。

### 1.2 自动探针（结果可复现）

```bash
npm run sec            # = node qa/probes/probe-security.js && node qa/probes/probe-security.js --selftest
```

`PASS true DETAIL {"root":".","fail":0,"suspect":0,"skip":4}`

| 组 | 检查 | 结论与证据 |
|---|---|---|
| S1 | 零运行时依赖 | `dependencies=[] devDependencies=[]` |
| S2 | 生产源码零外联 URL | 非 loopback 的 `http(s)://` 零命中 |
| S3 | 无 shell / 无命令拼接 | 无 `shell:true`、无 `exec*`；安装器唯一子进程调用是数组传参 + `shell:false` |
| S4 | 安装器路径纪律 | `ID_RE` 白名单在 `--profile` / `--base` 两处生效 + `path.resolve(opts.home)` |
| S5 | 本地页 CSP | `%CSP%`/`%NONCE%` 占位 + `cspFor` 无 `unsafe-inline/eval` + 响应头 `content-security-policy` + `x-content-type-options: nosniff` |
| S6 | 注入面 | 无 `eval` / `new Function` / `document.write` / `insertAdjacentHTML`；`innerHTML` 只用于清空 |
| S7 | 只绑 loopback | 本地页 `listen(PORT,'127.0.0.1')` + `ALLOWED_HOSTS`；面板 `isLoopbackHost` 对 Host 与 Origin 双校验 |
| S8 | **记忆闸门（功能探针）** | 真跑一次 `buildPersonaPrompt`：`proposed进了=false`、`confirmed进了=true`、`手工条目进了=true` |
| S9 | 仓库无真实凭据 | `ghp_/github_pat_/sk-/AKIA/PRIVATE KEY` 全仓零命中 |
| S10 | `.gitignore` 覆盖 | `node_modules/ data/ out/ build/ .env *.log` 全在 |
| S11 | 版本库无二进制大件 | `git ls-files` 里 png/zip/exe/blend/glb… 零命中 |

### 1.3 探针自身的三次返工（记在台账里，别下次再犯）

| 现象 | 根因 | 规避 |
|---|---|---|
| S3 误报 `install-dsh.mjs:23 shell:true` | 命中的是**注释里**引用的纪律原文 | 探针一律跳过注释行（`isComment`） |
| S5 漏报 CSP 响应头 | 该头走 `res.writeHead(200, {...})` 的对象字面量，不是 `setHeader(` | 按 header key 匹配，不按 API 形态匹配 |
| S8 直接 SKIP（Windows） | 动态 `import()` 绝对路径需要 `file:` URL | 统一 `pathToFileURL(...).href` |

结论：**探针也要过自测**。`--selftest` 在临时目录种 4 类违规（依赖红线 / 外联 URL / `eval` + 非清空 `innerHTML` / `.gitignore` 缺失），断言探针会 `SEC_FAIL` 且退出码为 1 —— 实测 `SELFTEST true caught=[S1,S2,S6,S10]`。

### 1.4 人工复核（SKIP 不等于安全）

| 项 | 内容 | 本班结论 |
|---|---|---|
| M1 | 记忆确认行语义伪造 | 同进程文件信任的**固有上限**，代码拦不住；缓解是可审计（`node scripts/memory.mjs log`）。已写进 SECURITY.md，算设计前提不算漏洞 |
| M2 | 提示词注入逃逸 | 渲染文本的呈现缓解（「数据非指令」+ 引号包裹 + 换行折叠 + 剥离「」+ 30 条上限）本班人读复核，未发现可逃逸形态 |
| M3 | headless 不注入人设 | 宿主平面划分（CLI 一次性任务没有 agent-preset 名册），行为约定，非漏洞 |
| M4 | 第三方扫描结论复核 | CodeQL `js/bad-tag-filter`（high）与 `js/stack-trace-exposure`（medium）已在 0.8.1 处置；本轮改动**不触碰**这两处：`scripts/ui.html` 未改、500 回传路径未改 |

### 1.5 本轮改动（v0.9.0 → v0.9.1）的安全影响面

- 只动 `adapters/dsh-ui/client.js`（渲染层）+ `tests/` + 版本号 + 本次新增的 `qa/`；
- **未新增网络访问、未新增写盘路径、未新增子进程**；
- 新增的 CSS 规则只用宿主变量、无颜色字面量（C1–C11 作用域门在 `npm test` 里常驻）；
- 工具栏「保存」新增 `hasConfig` 分支：只影响按钮可点性，不改变写盘目标；
- 版本一致性：两个 sub 包 `0.8.1 → 0.9.1`，`.github/SECURITY.md` 支持版本表述 `0.8.x → 0.9.x`（此前陈旧）。

### 1.6 结论与交接点

**结论：sec-1 无新增阻塞项。** 探针 11 组全绿且自测通过；人工项 4 条已带过并留证；本轮改动无新增攻击面。

给下一班的交接点：

1. 每轮改动后跑 `npm run sec`，把 `PASS <bool> DETAIL {...}` 与结论追到 §审查记录 表；
2. **一旦新增网络 / 子进程 / 写盘路径，先加探针组再动代码**（探针是新面的入场券）；
3. M1、M2 在每次涉及 `core/memoryInbox.js` 或渲染文案的改动后都要重读一遍；
4. 探针改过之后必须跑 `--selftest` —— 没有自测的探针等于没有探针。
