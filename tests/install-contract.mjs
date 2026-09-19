// 安装契约冒烟（0.11.1 起；I4 于 0.11.2 加）：包必须能被 dsh 当成 profile 层自动挂载，
// 且「面板行只能有一个来源」——bundle 已挂时 profile 层不许再插同名 entry。
// 触发来源：2026-09-19 实测 dsh plugin add 后只躺进 dependencies、不打补丁 —— 用户装完不生效。
// 判据：dsh.bundle.patch 声明存在、指向的文件存在、该补丁挂的是设置面板（人设本体走 agent preset，故意不在这层）。
import { readFileSync, existsSync, mkdtempSync, symlinkSync, unlinkSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const t = (name, ok) => {
  console.log(name + ':', ok)
  if (!ok) process.exitCode = 1
}

const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const rel = pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch
t('I1 声明 dsh.bundle.patch:', typeof rel === 'string' && rel.length > 0)
t('I1 指向的文件存在:', !!rel && existsSync(path.join(ROOT, rel)))
t('I1 patch 被 files 白名单收进包里:', Array.isArray(pkg.files) && pkg.files.some((f) => String(f).includes('cordis.patch.yml')))

const patch = rel && existsSync(path.join(ROOT, rel)) ? readFileSync(path.join(ROOT, rel), 'utf8') : ''
t('I2 补丁挂设置面板:', /name:\s*'@shenA2024\/whale-persona-ui'/.test(patch))
t('I2 补丁**不**挂人设本体到 profile 层（口径：鲸鱼模式专属）:', !/name:\s*'@shenA2024\/whale-persona'\s*$/.test(patch.replace(/\r/g, '')))
t('I3 包入口与 global 入口都还在:', !!pkg.exports['.'] && !!pkg.exports['./global'])
t('I3 零运行时依赖（决定 Release tarball 能否独立安装）:', !pkg.dependencies && !pkg.devDependencies)

// ── I4 重复挂载守卫（0.11.2）─────────────────────────────────────────────────
// 触发来源：2026-09-19 干净 DSH_HOME 实测 —— dsh plugin add 会把声明 dsh.bundle 的依赖自动挂进
// profile 的 dsh.profile.bundles，而那个 bundle 的 patch 里已经插了设置面板行；旧安装脚本看不出来，
// 又往 profile patch 里插一条同 id 行 → loader 报 duplicate loader entry id → 整个插件树起不来。
// 判据：bundle 已挂时 profile 层一条都不留；重装能把已经写坏的那条摘回来；别的 insert 不许误伤。
// 纯判定在 scripts/ui-row.mjs；安装脚本 scripts/install-dsh.mjs 只负责读盘与落盘。
// Windows 上裸绝对路径不能直接 import，必须走 file:// URL
const { planUiRow, applyUiRow } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'ui-row.mjs')).href)
const TPL = '# Your patch layer for this dsh profile, applied after every bundle layer:\n[]\n'
const UI_LINE = '- id: whale-persona-ui'
const BROKEN = "# patch\n\n- insert:\n    - id: whale-persona-ui\n      name: '@shenA2024/whale-persona-ui'\n"
const FOREIGN = "# patch\n\n- insert:\n    - id: someone-else\n      name: 'x'\n"
const BUNDLE = '@shenA2024/whale-persona'

t('I4 bundle 已挂时不往 profile 层插行:', planUiRow({ profilePatch: TPL, bundleOwner: BUNDLE }).action === 'none')
const fixed = applyUiRow({ profilePatch: BROKEN, bundleOwner: BUNDLE })
t('I4 已经写坏的重复行会被摘掉:', fixed.action === 'remove' && !fixed.text.includes(UI_LINE))
t('I4 摘完留合法空列表而不是空文件:', /\[\]/.test(fixed.text))
const added = applyUiRow({ profilePatch: TPL, bundleOwner: '' })
t('I4 没有 bundle 来源时仍然手工挂:', added.action === 'add' && added.text.includes(UI_LINE))
t('I4 用户自己写的别的 insert 不误删:', applyUiRow({ profilePatch: FOREIGN, bundleOwner: BUNDLE }).text === FOREIGN)
t('I4 幂等：修完再算一次是 none:', planUiRow({ profilePatch: fixed.text, bundleOwner: BUNDLE }).action === 'none')
t('I4 幂等：手工挂完再算一次是 none:', planUiRow({ profilePatch: added.text, bundleOwner: '' }).action === 'none')

// 自愈路径返工（同轮实测）：修完若留下两个 `[]`，文件就成了两个 YAML 文档，
// dump-config 直接抛 YAMLException: end of the stream or a document separator is expected ——
// 比原来的重复 id 更难查。空列表行的处理必须收敛到恰好一份。
const BROKEN_WITH_EMPTY = "# patch\n[]\n- insert:\n    - id: whale-persona-ui\n      name: '@shenA2024/whale-persona-ui'\n"
const healed = applyUiRow({ profilePatch: BROKEN_WITH_EMPTY, bundleOwner: BUNDLE }).text
t('I4 自愈后只剩一个空列表（不是两个 YAML 文档）:', (healed.match(/^\[\]$/gm) || []).length === 1)
t('I4 自愈后没有残留的 UI 行:', !healed.includes(UI_LINE))
const addedToDoubled = applyUiRow({ profilePatch: '# patch\n[]\n[]\n', bundleOwner: '' }).text
t('I4 补行时同样收敛空列表:', !/^\[\]$/m.test(addedToDoubled) && addedToDoubled.includes(UI_LINE))
t('I4 空文件也能长出合法内容:', applyUiRow({ profilePatch: '', bundleOwner: '' }).text.startsWith('- insert:'))

// ── I5 经 junction / symlink 路径跑安装脚本，必须真的执行 ──────────────────────
// 触发来源：0.11.2 的 tarball 通道实测 —— pnpm 把包装进 .pnpm 再 junction 到 node_modules，
// 那时 `process.argv[1]` 是 junction 路径而 `import.meta.url` 是 realpath，"比字符串判断自己是不是
// 入口"当场判错 → main() 静默不跑、退出码还是 0：用户"装完了"，其实什么都没发生。
// 修法是把纯判定拆成独立模块，安装脚本无条件执行。这条断言用真 symlink 把整仓链过去跑一次。
const tmp = mkdtempSync(path.join(os.tmpdir(), 'wp-link-'))
try {
  const linked = path.join(tmp, 'repo-link')
  symlinkSync(ROOT, linked, 'junction')
  const home = path.join(tmp, 'home')
  const run = spawnSync(process.execPath, [path.join(linked, 'scripts', 'install-dsh.mjs'), '--home', home, '--dry-run'], { encoding: 'utf8' })
  t('I5 经 junction 调用时脚本真的执行（不是静默空操作）:', String(run.stdout || '').includes('whale-persona: DSH_HOME'))
  t('I5 经 junction 调用时退出码为 0:', run.status === 0)
} finally {
  try { unlinkSync(path.join(tmp, 'repo-link')) } catch { /* 已经没了就算了 */ }
  rmSync(tmp, { recursive: true, force: true })
}
