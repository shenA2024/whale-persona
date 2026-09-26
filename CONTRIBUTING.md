# 贡献指南

## 先知道的四件事

1. **零运行时依赖、不联网、不派生进程**是硬约束。要新增网络访问 / 子进程 / 写盘路径，得先在
   `qa/probes/probe-security.js` 里加一组探针，再动代码——探针是新面的入场券。
2. **文案与样式都被测试钉着**。改 `adapters/dsh-ui/client.js` 里的可见文案，必须同步
   `tests/ui-panel.mjs` 的断言（N4 / N6b / N6c / N9 逐字钉死）。
3. **样式只有一层**：所有选择器必须落在 `.wpr-*` 内、颜色只走宿主变量 `--dsw-*`，
   `tests/ui-css-scope.mjs` 的 C1–C11 会拦；纯布局属性安全，自带配色会挂。
4. **改 `core/` 之后要跑 `node scripts/sync-core.mjs`**，把改动同步到 ZCode 的 vendor 副本（测试 Z7 校验一致性）。

## 本地怎么验

```bash
npm test       # 15 套功能测试（见 package.json 的 test 脚本：冒烟/全局/预设/酒馆卡/收件箱/模型名/形象语气/设置面板/样式作用域/ZCode hook/本地页/安装契约/条件反射/造规则闸门/路径存在性）
npm run sec    # 安全探针 16 组 + 自测；改了探针必须让 --selftest 仍然通过
```

两个都要绿。CI（`.github/workflows/ci.yml`）会在 ubuntu 与 windows × node 20/22 上跑同样两条。

## 提交与 PR

- 一个改动一件事；commit message 写**触发来源**（谁在什么场景下提出/踩到）与**验证方式**（跑了什么、看到什么）。
- PR 请过一遍模板里的清单。
- 我们在意「证据」，不在意「措辞漂亮」：结论要有命令输出 / 文件行号 / 字节数撑着。

## 网络（本机在国内，2026-09-22 实测）

三条工具**各认各的代理**，混着用会得到互相矛盾的结论：

- **git**：走 `http://127.0.0.1:10808`（v2rayN）。本机已在 `git config` 里钉了
  `http.proxy` / `https.proxy`；代理没起时 push / fetch 必失败。
- **pnpm**：**不读 git 的配置**。跑 `dsh plugin --profile web add -w <GitHub tarball 地址>` 之前，
  必须给它环境变量：

  ```powershell
  $env:HTTP_PROXY = $env:HTTPS_PROXY = 'http://127.0.0.1:10808'
  ```

  不设就是 `ETIMEDOUT <ip>:443`（2026-09-22 实测；见坑库同名卡）。

- **npm**：默认 registry 是镜像 `https://registry.npmmirror.com`。所以
  - `whoami` / `view` / `publish` 这类命令**要显式带** `--registry https://registry.npmjs.org`，
    否则会出现"凭据明明在 `.npmrc` 里却报 ENEEDAUTH"这种假故障（2026-09-22 实测踩过）；
  - 新版本发布后镜像有**同步延迟**：装的人若走镜像拿不到最新版，先用官方 registry 复核一次再下结论
    （本次 0.15.1 发布后实测镜像已同步）。
- **`api.github.com` 直连可用**：代理没起时也能拿它判远端版本与 Release 附件，比 `git ls-remote` 稳。

## 发布清单（每次发版逐条打勾）

> 触发来源：2026-09-19 发 v0.11.1 时连踩两个坑 —— 附件传成上一版、包里没有 `dsh.bundle` 声明。
> 每条都是**可执行动作**或**可判定判据**；打不动的条目不许跳过。

### 1 代码与门禁

- [ ] `npm test` → **exit 0**（11+ 套，含 `tests/install-contract.mjs`）
- [ ] `npm run sec` → **PASS true**，且 `--selftest` 仍能抓出全部种下的违规
- [ ] 版本 **lockstep**：根包 + `adapters/dsh` + `adapters/dsh-ui` 三处一起改
- [ ] 改过 `core/` 就跑过 `node scripts/sync-core.mjs`（ZCode vendor 副本，测试 Z7 校验）
- [ ] `CHANGELOG.md` 加了新版本节，写清**触发来源**与**验证方式**
- [ ] 提交者身份对：`git log -1 --format=%an%n%ae` 应为 `shenA2024 <shenA2024@users.noreply.github.com>`
      （**不要**出现真名或私人邮箱；历史里有旧残留不代表新提交可以再写进去）

### 2 安装契约（这一条最容易漏）

- [ ] `package.json` 有 `dsh.bundle.patch`，且指向的文件**真实存在**
- [ ] 该文件被 `files` 白名单收进包里（声明了却打不进 tarball 等于没声明）
- [ ] 判据：`npm pack --dry-run 2>&1 | Select-String cordis` 能看到补丁文件
- [ ] **改过安装脚本就必须从 Release 下载的包里跑一次**（`node <profile>/node_modules/whale-persona/scripts/install-dsh.mjs`），
      **看到日志**才算过：仓库里直跑没有 pnpm 的 junction，两条路径结论可能相反
      （v0.11.2 的「静默空操作」就是这么漏过去的）
- [ ] **改过挂载方式就必须空 profile 实测一次**：
      `dsh plugin add` 之后 `dsh.profile.bundles` 里应出现本包名，且**不再**有
      `warning: declares no dsh.bundle` —— 只有这句警告消失，才算"装完即生效"

### 3 打 tarball 与建 Release

- [ ] `npm pack` 出 `whale-persona-<版本>.tgz`，记下**字节数 + sha256**
- [ ] 打完之后**把文件挪出仓库根**（别让 `.tgz` 留在工作树里）
- [ ] GitHub → Releases → Draft a new release：**标签必须选本次版本号**（选错 = README 的一键命令 404）
- [ ] 附件传**本次那份** tarball，文件名一个字符都别改
- [ ] 立项标签选 `最新的`；不是灰度就别勾 `预发布`
- [ ] 发布后再验三条（别只看页面）：
      ① `https://api.github.com/repos/<owner>/<repo>/releases/latest` 的 `tag_name` 与 `assets[].size` 对得上；
      ② 从 `releases/download/<tag>/<file>` **真下载一次**，sha256 与本地原件一致；
      ③ 用那条一键命令在**空 profile** 里装一次，确认落地的版本号与 bundles 都对

### 4 本地生效（本机维护者专用）

- [ ] 本机活挂载是 junction 指向本仓库，所以**改完即刻生效**；只有换挂载点或改挂载层级才需要重启 DSH
- [ ] 人设改动只在**新建**会话生效（人设段在会话创建时绑定）

### 5 发 npm（0.15.0 起）

> 触发来源：2026-09-22 用户反馈"装不动"，维护者拍板上 npm。npm 发出去收不回（版本只能 deprecate，不能删），
> 所以这一节的第一条是**机器判据**，不是人眼复查。

- [ ] `npm run prepublish-check` → **exit 0**，且**不带 `--no-words`**
      （带那个开关只跑结构判据，**不算过闸** —— 私人内容扫描会被跳过）
- [ ] 词表在哪：`<repo>/data/prepublish-words.txt`（gitignore）或
      `$DSH_HOME/whale-persona/prepublish-words.txt`；想到新的私词就加进去，加完**再跑一次闸门**
- [ ] 版本必须**比线上大**：`npm view whale-persona version` 看线上，与本地 `package.json` 对比
- [ ] `npm publish`（`publishConfig` 已钉官方 registry；账号开 2FA）
- [ ] 发布后验三条（别只看页面）：
      ① `npm view whale-persona version` 与本次版本一致；
      ② `npm view whale-persona dist.tarball` 下载下来，sha256 与本地 `npm pack` 那份一致；
      ③ 在**空 profile** 里用 `npx -y whale-persona` 装一次，确认落地的版本号与 bundles 都对
- [ ] GitHub Release 附件照旧发（§3）—— 两条通道并行，tarball 留给拿不到 npm 的人

## 不适合走 Issue 的

- **安全问题**：走[私有漏洞报告](https://github.com/shenA2024/whale-persona/security/advisories/new)，不要开公开 Issue（见 [SECURITY.md](.github/SECURITY.md)）。
- **用法提问 / 想法**：优先发 [Discussions](https://github.com/shenA2024/whale-persona/discussions)。

## 已知但没做的事（记录，不是排期）

- **README 里「与 `npm pack` 出来的完全同一份文件」按字节不成立**：两条通道打出的 tarball 字节数不同
  （2026-09-22 实测：npm 侧 228180 / GitHub Release 侧 227062），解包内容一致（都是 76 个条目）。
  改成"同一份内容"要动包内文件，等下一个版本一起改。
- **`scripts/install-dsh.mjs` 的结尾提示可以更明确**：现在只说"挂载行变更需要重启宿主进程"，
  没说"不重启则人设不生效"，新手容易以为装完就好了。同属包内文件，等下次发版。
- **npm 2FA 的 web 授权在非交互终端走不完**：CLI 会把包暂存住、版本号被占住，
  发布得在真实交互式终端里跑，或由人在浏览器完成授权 —— 见坑库同名卡。
