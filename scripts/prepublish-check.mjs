#!/usr/bin/env node
/**
 * 发布前闸门（0.15.0 新增）—— npm 发出去收不回（版本只能 deprecate，不能删），所以这一步必须机器判，
 * 不能靠"我检查过了"。
 *
 * 触发来源：2026-09-22 维护者拍板上 npm 时明确要求「任何要公开的安装包，发布前必须检查有没有夹带
 * 私人内容」。本仓是公开仓，因此**词表本身不进仓**（否则扫描器自己就是泄漏源）：词表从仓库外的
 * 私有位置读，读不到就红，绝不"没词表就当干净"（静默降级 = 闸门形同虚设）。
 *
 * 判据（任一不过 = 非零退出）：
 *   P1 私有词表必须拿得到（--no-words 时才允许跳过，且会在输出里明说"未做内容扫描"）
 *   P2 真包里每个文件都在 package.json 的 files 白名单内
 *   P3 真包里没有个人配置文件名的东西（config.json / memory-inbox.jsonl / .env / .npmrc / *.local.*）
 *   P4 真包内文本命中词表 = 红（只报「文件:行 + 词表第几条」，**不回显命中内容**，避免把它打进 CI 日志）
 *
 * 用法：
 *   node scripts/prepublish-check.mjs              # 发布前必跑（发布清单 §5）
 *   node scripts/prepublish-check.mjs --no-words   # 只跑结构判据（CI 用；不扫词）
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const argv = process.argv.slice(2)
const noWords = argv.includes('--no-words')

let fail = 0
const ok = (m) => console.log('  OK   ' + m)
const bad = (m) => { fail++; console.log('  FAIL ' + m) }
const t = (name, pass, detail) => (pass ? ok(name + (detail ? ' :: ' + detail : '')) : bad(name + (detail ? ' :: ' + detail : '')))

// ── P1 词表（仓库外）────────────────────────────────────────────────────────
/**
 * 候选位置逐个试，全部满足「不会被提交、不会被打进包」：
 *   ① 环境变量 WHALE_PREPUBLISH_WORDS
 *   ② <repo>/data/prepublish-words.txt   —— data/ 在 .gitignore 里，也不在 files 白名单里（本机最省事的位置）
 *   ③ $DSH_HOME/whale-persona/prepublish-words.txt（与插件私有配置同址）
 *   ④ ~/.dsh/whale-persona/prepublish-words.txt
 * 一个都找不到就红 —— 绝不"没词表就当干净"。
 */
function wordsPath() {
  const cands = []
  if (process.env.WHALE_PREPUBLISH_WORDS) cands.push(process.env.WHALE_PREPUBLISH_WORDS)
  cands.push(path.join(ROOT, 'data', 'prepublish-words.txt'))
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  cands.push(path.join(home, 'whale-persona', 'prepublish-words.txt'))
  cands.push(path.join(os.homedir(), '.dsh', 'whale-persona', 'prepublish-words.txt'))
  return cands.find((p) => existsSync(p)) || ''
}
const WORDS_FILE = wordsPath()
let words = []
if (noWords) {
  console.log('注意：--no-words —— 本次**未做私人内容扫描**，只跑结构判据。发布时必须不带这个开关。')
} else if (!WORDS_FILE) {
  bad('私有词表没找到（四个候选位置都没有）')
  console.log('     建法：一行一条，只写你不想公开出现的词（人名/称呼/私有路径/私有项目名）。')
  console.log('     推荐位置：<repo>/data/prepublish-words.txt（data/ 已被 gitignore，也不会进包）')
  console.log('     或设 WHALE_PREPUBLISH_WORDS=<文件路径>。')
} else {
  words = readFileSync(WORDS_FILE, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'))
  ok('词表已加载 :: ' + words.length + ' 条（' + WORDS_FILE + '）')
}

// ── 打真包 ──────────────────────────────────────────────────────────────────
/** 不经 shell 调 npm（Node ≥ 20 拒绝直接 spawn .cmd；安全探针 S3 禁 shell:true）。与 pack-release.mjs 同一手法。 */
function npmCli() {
  if (process.env.npm_execpath && existsSync(process.env.npm_execpath)) return process.env.npm_execpath
  return [
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(process.execPath), 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].find((p) => existsSync(p))
}
const TMP = path.join(ROOT, 'data', 'prepublish-tmp')
rmSync(TMP, { recursive: true, force: true })
mkdirSync(TMP, { recursive: true }) // npm pack 不会自己建目标目录
// data/ 在 .gitignore 里、也不在 files 白名单里 —— 临时产物绝不会被打进包
execFileSync(process.execPath, [npmCli(), 'pack', '--pack-destination', TMP], { cwd: ROOT, encoding: 'utf8' })
const tgz = readdirSync(TMP).filter((f) => f.endsWith('.tgz')).map((f) => path.join(TMP, f))[0]
if (!tgz) { console.error('npm pack 没产出 tgz'); process.exit(1) }
const bytes = statSync(tgz).size
const ex = mkdtempSync(path.join(TMP, 'x-'))
execFileSync('tar', ['-xzf', tgz, '-C', ex], { encoding: 'utf8' })
const PKG = path.join(ex, 'package')

function walk(dir, base = '') {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? base + '/' + e.name : e.name
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel))
    else out.push(rel)
  }
  return out
}
const files = walk(PKG)
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
console.log('包：' + path.basename(tgz) + ' · ' + files.length + ' 个文件 · ' + bytes + ' bytes · v' + pkg.version)

// ── P2 白名单 ───────────────────────────────────────────────────────────────
const allowed = (pkg.files || []).map((f) => String(f).replace(/^\.\//, '').replace(/\/+$/, ''))
const covered = (p) => allowed.some((a) => p === a || p.startsWith(a + '/'))
const stray = files.filter((p) => !covered(p) && p !== 'package.json')
t('P2 包内每个文件都在 files 白名单内', stray.length === 0, stray.length ? stray.slice(0, 5).join(', ') : files.length + ' 个全在白名单内')

// ── P3 个人配置文件名的东西 ─────────────────────────────────────────────────
const BANNED = [/^config\.json$/i, /^memory-inbox\.jsonl$/i, /^\.env(\.|$)/i, /^\.npmrc$/i, /(^|\/)\.local\./i, /(^|\/)\.workbuddy\//i, /(^|\/)data\//i]
const bannedHits = files.filter((p) => BANNED.some((r) => r.test(p)))
t('P3 包里没有个人配置类文件名', bannedHits.length === 0, bannedHits.slice(0, 5).join(', '))

// ── P4 内容扫描 ─────────────────────────────────────────────────────────────
if (noWords) {
  console.log('  跳过 P4 私人内容扫描（--no-words）')
} else if (!words.length) {
  bad('P4 没有词表可扫 —— 没扫过就不算干净')
} else {
  const hits = []
  for (const rel of files) {
    const buf = readFileSync(path.join(PKG, rel))
    if (buf.includes(0)) continue // 二进制不扫
    const text = buf.toString('utf8')
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      for (let w = 0; w < words.length; w++) {
        if (lines[i].includes(words[w])) hits.push(rel + ':' + (i + 1) + ' ← 词表第 ' + (w + 1) + ' 条')
      }
    }
  }
  // 不回显命中内容：日志里只留"哪一行、词表第几条"
  t('P4 包内文本无词表命中', hits.length === 0, hits.length ? '\n       ' + hits.slice(0, 10).join('\n       ') : files.length + ' 个文件全扫过')
}
rmSync(TMP, { recursive: true, force: true })

console.log(fail ? '发布闸门：不通过（' + fail + ' 项）—— 别发。' : '发布闸门：通过。')
process.exitCode = fail ? 1 : 0
