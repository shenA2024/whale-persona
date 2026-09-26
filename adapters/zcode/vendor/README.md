# vendor/core —— 自动生成，勿手改

本目录是仓库根 `core/` 的**逐字节副本**，给 ZCode 侧免安装使用（`adapters/zcode/` 直接 import 这里的文件，
不依赖仓库根目录的 `core/`）。

**改动流程**：改 `core/` → 跑 `npm run sync-core` → 提交两边的改动。

- 生成器：`scripts/sync-core.mjs`（`npm run sync-core`）
- 一致性：`tests/zcode-hook.mjs` 的 Z7 / Z8 逐字节比对 `core/` 与本目录 —— 手改这里必被测试抓住
- 为什么用副本而不是符号链接：Windows 上 junction / 符号链接在 npm 打包与跨盘使用时会失效，
  副本是各环境下唯一稳的做法；代价就是这份「改动要同步」的纪律

**冻结声明**（2026-09-26，外部评审整改处置）：本目录不新增独有的实现文件；任何行为改动都先落 `core/`，
再由 `sync-core` 带过来。这个 README 是目录里唯一手写的文件。
