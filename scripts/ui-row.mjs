/**
 * whale-persona —— 「设置面板行只允许一个来源」的判定（纯函数，不碰磁盘）
 *
 * 为什么单独一个文件：安装脚本 scripts/install-dsh.mjs 既要能被 `node` 直接跑成安装器，
 * 又要让 tests/install-contract.mjs 能 import 这套判定做回归。0.11.2 用的是「拿
 * process.argv[1] 与 import.meta.url 比字符串」来判断"自己是不是入口"—— 而 pnpm 把包装进
 * `.pnpm` 再 junction 出来之后，argv[1] 是 junction 路径、import.meta.url 是 realpath，
 * 判定失败 → main() 静默不跑、退出码还是 0：走 tarball 通道的用户"装完了"，其实什么都没发生。
 * 拆成独立模块后，安装脚本无条件执行，这类静默空操作不可能再出现。
 *
 * 触发来源（本文件要解决的问题）：2026-09-19 干净 DSH_HOME 实测 —— `dsh plugin add` 会把声明
 * `dsh.bundle` 的依赖自动追加进 profile 的 `dsh.profile.bundles`，而那个 bundle 的补丁里已经
 * 插了 `whale-persona-ui`；安装脚本旧版只看 profile 自己的 `cordis.patch.yml`，于是又插一条
 * 同 id 行。loader 的 entry id 全局唯一，两层各插一次 = duplicate loader entry id = 整个插件树
 * 加载失败、DSH 起不来。判据：同一 id 只能有一个来源；bundle 已经挂了，profile 层就一条都不该留。
 */

/** 设置面板行的身份证：id 与包名 */
export const UI_ROW_ID = 'whale-persona-ui'
export const UI_ROW_NAME = 'whale-persona-ui'

/** 安装脚本会写进 profile patch 的那一块（幂等识别与移除都只认这一份） */
export const UI_BLOCK = ['- insert:', '    - id: ' + UI_ROW_ID, "      name: '" + UI_ROW_NAME + "'"]

/**
 * 摘掉安装脚本自己写过的那一块。块里必须**只有**这一条 insert，别的行一律不碰。
 * @param {string} text - profile patch 文件内容
 * @returns {{ text: string, removed: boolean }}
 */
export function stripUiBlock(text) {
  const lines = String(text).split(/\r?\n/)
  const out = []
  let removed = false
  for (let i = 0; i < lines.length; i++) {
    if (!removed && /^- insert:\s*$/.test(lines[i])) {
      const block = []
      let j = i + 1
      while (j < lines.length && lines[j].trim() !== '' && !/^- /.test(lines[j])) { block.push(lines[j]); j++ }
      const ids = block.filter((line) => new RegExp('^\\s*- id:\\s*' + UI_ROW_ID + '\\s*$').test(line)).length
      const names = block.filter((line) => new RegExp("^\\s*name:\\s*'" + UI_ROW_NAME.replace(/[/@]/g, (c) => '\\' + c) + "'\\s*$").test(line)).length
      if (ids === 1 && names === 1 && block.length === 2) {
        removed = true
        i = lines[j] === '' ? j : j - 1
        continue
      }
    }
    out.push(lines[i])
  }
  return { text: out.join('\n'), removed }
}

/** 去掉所有「空列表占位行」：`[]` 在补丁栈里是 no-op，留两份会把文件变成两个 YAML 文档直接解析失败 */
export function withoutEmptyListLines(text) {
  return String(text)
    .split(/\r?\n/)
    .filter((line) => !/^\s*\[\s*\]\s*$/.test(line))
    .join('\n')
    .replace(/\s+$/, '')
}

/** 收尾：还留着 entry 就原样交回，一条都没有就补一个（也只有一个）空列表 */
export function keepValidListForm(text) {
  const body = withoutEmptyListLines(text)
  const hasEntry = body.split(/\r?\n/).some((line) => /^- /.test(line))
  const head = body === '' ? '' : body + '\n\n'
  return hasEntry ? body + '\n' : head + '[]\n'
}

/**
 * 设置面板行该不该留在 profile patch 层。
 * @param {{ profilePatch?: string, bundleOwner?: string }} input - profile patch 文本 + 已挂 bundle 里插了本行的包名
 * @returns {{ action: 'add'|'remove'|'none', reason: string }}
 */
export function planUiRow(input) {
  const text = String((input && input.profilePatch) || '')
  const owner = String((input && input.bundleOwner) || '')
  if (owner !== '') {
    if (stripUiBlock(text).removed) return { action: 'remove', reason: 'bundle ' + owner + ' 已挂同一条设置面板行，摘掉 profile 层的手工重复行' }
    return { action: 'none', reason: 'bundle ' + owner + ' 已挂设置面板行，profile 层不需要再加' }
  }
  if (text.indexOf(UI_ROW_NAME) >= 0) return { action: 'none', reason: 'profile patch 已有 UI 行，跳过' }
  return { action: 'add', reason: 'profile 层没有别的来源，由本脚本手工挂' }
}

/**
 * 算出 profile patch 文件该写成什么（不碰磁盘）。
 * @param {{ profilePatch?: string, bundleOwner?: string }} input - 同 planUiRow
 * @returns {{ action: 'add'|'remove'|'none', reason: string, text: string }}
 */
export function applyUiRow(input) {
  const text = String((input && input.profilePatch) || '')
  const plan = planUiRow(input)
  if (plan.action === 'remove') return { ...plan, text: keepValidListForm(stripUiBlock(text).text) }
  if (plan.action === 'add') {
    const body = withoutEmptyListLines(text)
    const head = body === '' ? '' : body + '\n\n'
    return { ...plan, text: head + UI_BLOCK.join('\n') + '\n' }
  }
  return { ...plan, text }
}
