# 变更记录

> 版本号口径：根包与两个 sub 包（`adapters/dsh`、`adapters/dsh-ui`）**lockstep**，一起动。
> 每条改动都写**触发来源**与**验证方式** —— 与本仓 CONTRIBUTING 的纪律一致。

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
