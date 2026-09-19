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
npm test       # 8 套功能测试（DSH 冒烟 / 收件箱 / 模型名 / 形象语气 / 设置面板 / 样式作用域 / ZCode hook / 本地页）
npm run sec    # 安全探针 11 组 + 自测；改了探针必须让 --selftest 仍然通过
```

两个都要绿。CI（`.github/workflows/ci.yml`）会在 ubuntu 与 windows × node 20/22 上跑同样两条。

## 提交与 PR

- 一个改动一件事；commit message 写**触发来源**（谁在什么场景下提出/踩到）与**验证方式**（跑了什么、看到什么）。
- PR 请过一遍模板里的清单。
- 我们在意「证据」，不在意「措辞漂亮」：结论要有命令输出 / 文件行号 / 字节数撑着。

## 不适合走 Issue 的

- **安全问题**：走[私有漏洞报告](https://github.com/shenA2024/whale-persona/security/advisories/new)，不要开公开 Issue（见 [SECURITY.md](.github/SECURITY.md)）。
- **用法提问 / 想法**：优先发 [Discussions](https://github.com/shenA2024/whale-persona/discussions)。
