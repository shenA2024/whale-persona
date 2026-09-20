#!/usr/bin/env node
/**
 * 路径存在性门禁：源码与文档里出现的 `node <路径>` 命令，那个路径必须真实存在。
 *
 * 触发来源（2026-09-20，第三方评审走读 v0.12.0）：`adapters/dsh/reflex/state.js` 的只读面板提示
 *   让 AI 去跑 `tools/check.mjs` —— 本仓没有 tools/ 目录，照着跑必失败；正确命令是
 *   `scripts/reflex.mjs check`。同轮还查出 `tests/reflex-rules.mjs` 的跑法注释写成了 `tests/newrule.mjs`。
 *   这类"命令指向不存在的文件"功能测试与安全探针都抓不到，此前只能靠人肉读——本文件把它变成机器判据。
 *
 * 判据：扫下面的面，抽出形如 `node <path>.mjs|js|cjs` 的引用，先按**文件所在目录**解析、再按**仓库根**解析，
 *   两处都说没有 → FAIL 并打印 `文件:行号 -> 路径`。两条解析规则是必要的：
 *   子包 package.json 里写的是 `node ../../tests/smoke.mjs`（相对子包），
 *   文档里写的是 `node scripts/ui.mjs`（相对仓库根）。
 * 扫描面：生产代码 core/ adapters/ scripts/；夹具与文档 tests/ qa/ docs/ examples/ .github/ 与根 README/CONTRIBUTING/CHANGELOG。
 * 豁免：文档里**要引用一条错的命令**（"别跑这个"）时，在那一行写 `paths-gate:exempt`，本门禁跳过该行 ——
 *   有出口，才不会有人为了写文档把整个门禁关掉。豁免是逐行的，不设全局开关。
 * 自测：`--selftest` 在临时目录种一条死引用 +一条活引用 +一条带豁免标记的死引用，
 *   断言门禁"只抓没豁免的那条"（门禁自己也得有牙）。
 * 跑法：node tests/paths.mjs（退出码非 0 = 有失败）；--selftest 只跑自测。
 */
import { existsSync, readFileSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const argv = process.argv.slice(2)
const onlySelftest = argv.includes('--selftest')

const SKIP_DIRS = new Set(['node_modules', '.git', 'data', '.tmp', 'out', 'build', 'dist', '.inbox', 'release'])
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.json', '.md', '.html', '.yml', '.yaml'])
const SCAN_DIRS = ['core', 'adapters', 'scripts', 'tests', 'qa', 'docs', 'examples', '.github']
const SCAN_FILES = ['README.md', 'CONTRIBUTING.md', 'CHANGELOG.md']
/** 行内出现本标记 = 该行是"引用错误命令"的文档，跳过（逐行豁免，无全局开关） */
const EXEMPT = 'paths-gate:exempt'
/** `node` 与路径之间只允许空白；路径里不许有 `<`/引号，避免把 `node <profile>/…` 这类占位符当引用 */
const REF = /node\s+([A-Za-z0-9_][A-Za-z0-9_./@-]*\.(?:mjs|js|cjs))\b/g

function walk(dir, acc) {
  const out = acc || []
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (TEXT_EXT.has(path.extname(name).toLowerCase())) out.push(p)
  }
  return out
}

/** 仓库**跟踪**的文件集合（git ls-files）。判据必须用它，不能用磁盘存在性 ——
 *  2026-09-20 CI 红了 6 次才想明白：本机 data/ 下有 gitignore 掉的夹具，existsSync 看得到、
 *  干净 clone 看不到，于是「本机绿 / CI 红」。读者只可能跑到仓库里真有的文件。
 *  非 git 目录（自测夹具）返回 null → 退回磁盘判据。 */
function trackedSet(root) {
  const r = spawnSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', shell: false })
  if (r.status !== 0 || !r.stdout) return null
  return new Set(r.stdout.split('\0').filter(Boolean).map((p) => path.resolve(root, p)))
}

/** 扫描面（root 可换成临时目录，供自测用） */
export function targets(root) {
  const out = []
  for (const d of SCAN_DIRS) walk(path.join(root, d), out)
  for (const f of SCAN_FILES) {
    const p = path.join(root, f)
    if (existsSync(p) && statSync(p).isFile()) out.push(p)
  }
  return out
}

/** 返回 { refs, misses }：refs = 扫到的引用条数（0 说明扫描面坏了，门禁会自己报 P2 失败） */
export function scan(root) {
  const misses = []
  const tracked = trackedSet(root)
  const has = (p) => (tracked ? tracked.has(p) : existsSync(p))
  let refs = 0
  for (const file of targets(root)) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].indexOf(EXEMPT) >= 0) continue
      REF.lastIndex = 0
      let m
      while ((m = REF.exec(lines[i])) !== null) {
        refs++
        const ref = m[1]
        const byFile = path.resolve(path.dirname(file), ref)
        const byRoot = path.resolve(root, ref)
        if (!has(byFile) && !has(byRoot)) {
          misses.push({
            where: path.relative(root, file).split(path.sep).join('/') + ':' + (i + 1),
            ref,
          })
        }
      }
    }
  }
  return { refs, misses, tracked: tracked ? tracked.size : null }
}

let checks = 0
let failed = 0
function check(label, cond, detail) {
  checks++
  if (!cond) failed++
  console.log((cond ? '' : 'FAIL ') + label + (detail === undefined ? '' : ' ' + detail))
}

// 自测：在临时目录里种一条死引用 + 一条活引用，断言门禁只抓死的那条
function selftest() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'whale-paths-'))
  try {
    mkdirSync(path.join(tmp, 'scripts'), { recursive: true })
    writeFileSync(path.join(tmp, 'scripts', 'real.mjs'), '// 存在\n', 'utf8')
    // 反例按片段拼接构造（'tools' + '/' + 'check.mjs'）：本文件也在扫描面里，
    // 把命令整串写成字面量会被自己判 FAIL，所以路径切开、运行时再拼出斜杠
    const deadRef = ['node', 'tools' + '/' + 'check.mjs'].join(' ')
    const liveRef = ['node', 'scripts' + '/' + 'real.mjs'].join(' ')
    writeFileSync(path.join(tmp, 'README.md'),
      '跑法：' + deadRef + '（死引用）\n'
      + '跑法：' + liveRef + '（活引用）\n'
      + '别跑：' + deadRef + '（' + EXEMPT + '）\n', 'utf8')
    const r = scan(tmp)
    const caughtDead = r.misses.length === 1 && r.misses[0].ref === 'tools/check.mjs'
    const keptLive = r.refs === 2
    check('S1 自测：抓到死引用', caughtDead, JSON.stringify(r.misses))
    check('S2 自测：放过活引用', keptLive, 'refs=' + r.refs)
    check('S3 自测：带豁免标记的行被跳过', r.misses.every((m) => m.where !== 'README.md:3'), JSON.stringify(r.misses))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

/** 只有被当作入口跑时才执行/退出；被 import 时只暴露 targets / scan（调试与复用需要） */
function main() {
  selftest()
  if (!onlySelftest) {
    const r = scan(ROOT)
    check('P1 全部 node 命令引用的路径都存在', r.misses.length === 0,
      r.misses.length ? JSON.stringify(r.misses.slice(0, 8)) : '(扫到 ' + r.refs + ' 条引用)')
    check('P2 扫描面非空（防"扫了个寂寞"式的假通过）', r.refs >= 50, 'refs=' + r.refs)
    check('P3 判据走的是 git 跟踪集（不是磁盘存在性）', typeof r.tracked === 'number' && r.tracked > 50, 'tracked=' + r.tracked)
  }
  console.log('-- 路径存在性：' + checks + ' 项' + (failed ? '，失败 ' + failed : '全过'))
  process.exit(failed ? 1 : 0)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
