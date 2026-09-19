## 改了什么

<!-- 一句话说清；涉及可见文案/样式的，把「改前 → 改后」写上 -->

## 触发来源

<!-- 谁在什么场景下提出的（日期 + 原话/场景）。本仓的 commit 与坑卡都要求这一栏 -->

## 验证

- [ ] `npm test` 全绿
- [ ] `npm run sec` 全绿（改了探针的话 `--selftest` 也要绿）
- [ ] 改了 `adapters/dsh-ui/client.js` 的可见文案 → 已同步 `tests/ui-panel.mjs` 的钉死串
- [ ] 改了 `core/` → 已跑 `node scripts/sync-core.mjs`
- [ ] 没有新增网络访问 / 子进程 / 写盘路径；若有，已在 `qa/probes/probe-security.js` 加组，并在 `qa/security-审查.md` 追一行结论

## 影响面

<!-- 对老用户有没有行为变化？配置需不需要迁移？要不要重启 DSH？ -->
