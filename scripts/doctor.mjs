#!/usr/bin/env node
/**
 * 共存体检（0.14.0）—— 回答一个具体担心：「装了这个，会不会和别的插件打架？」
 *
 * 判据全部来自**磁盘事实**，不猜、不吓人：
 *   ① 我们占了哪些名字（段名 / 命令名 / loader id / agent preset / 配置目录）；
 *   ② 已装插件里还有谁声明同一批段名或同一个命令名（只读各包**入口文件**，不递归 node_modules）；
 *   ③ profile 的 cordis.patch.yml 里有没有重复 loader id（宿主会硬错、整棵树起不来的那种）；
 *   ④ 我们的配置目录有没有跟别人共用。
 *
 * 为什么只读入口文件：node_modules 递归扫描在真实工程里要几十秒到几分钟（本机实测直接超时），
 * 而「声明了同名段/同名命令」这件事一定写在入口或其直接 import 的模块里 —— 够用，且快。
 *
 * 退出码：0 = 没发现冲突级问题（可能有提示）；1 = 有冲突级问题。
 * 跑法：node scripts/doctor.mjs [--json]
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const argv = process.argv.slice(2)
const asJson = argv.includes('--json')

/** 我们占用的名字（改这里 = 改契约，必须同步改 README 的「共存与冲突」一节） */
export const OURS = {
  sections: [
    'deployment:persona-prefix', 'deployment:persona-suffix', 'whale:thinking-language',
    'whale:persona-global', 'whale:persona-global-suffix', 'whale:global-thinking-language',
  ],
  commands: ['memory'],
  loaderIds: ['whale-persona-ui'],
  packages: ['whale-persona', 'whale-persona-ui'],
  preset: 'whale-persona',
  configDirs: ['whale-persona', 'whale-suite'],
}

const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')

function readText(p, limit = 400000) {
  try {
    const st = statSync(p)
    if (!st.isFile() || st.size > limit) return ''
    return readFileSync(p, 'utf8')
  } catch {
    return ''
  }
}

/** 包的入口文件清单（package.json 的 main/exports + 顶层 js/mjs）——刻意不递归 */
export function entryFiles(pkgDir) {
  const out = []
  const pkgJson = readText(path.join(pkgDir, 'package.json'))
  try {
    const j = JSON.parse(pkgJson)
    const add = (v) => { if (typeof v === 'string' && v.endsWith('.js')) out.push(path.join(pkgDir, v)) }
    add(j.main)
    for (const v of Object.values(j.exports || {})) {
      if (typeof v === 'string') add(v)
      else if (v && typeof v === 'object') for (const w of Object.values(v)) add(w)
    }
  } catch { /* 坏 package.json：只靠顶层扫描 */ }
  try {
    for (const name of readdirSync(pkgDir)) {
      if (/\.(js|mjs|cjs)$/.test(name)) out.push(path.join(pkgDir, name))
    }
  } catch { /* 目录读不了 */ }
  return [...new Set(out)]
}

/** 一个包里声明了我们的哪些名字 */
export function claimsOf(pkgDir) {
  const hits = []
  for (const f of entryFiles(pkgDir)) {
    const t = readText(f)
    if (!t) continue
    for (const s of OURS.sections) if (t.includes(s)) hits.push('section:' + s)
    for (const c of OURS.commands) if (new RegExp("name:\\s*['\"]" + c + "['\"]").test(t)) hits.push('command:' + c)
  }
  return [...new Set(hits)]
}

function listDirs(p) {
  try { return readdirSync(p).filter((n) => { try { return statSync(path.join(p, n)).isDirectory() } catch { return false } }) }
  catch { return [] }
}

function scanInstalled() {
  const found = []
  const profilesDir = path.join(home, 'profiles')
  for (const prof of listDirs(profilesDir)) {
    const nm = path.join(profilesDir, prof, 'node_modules')
    for (const scope of listDirs(nm)) {
      const scopeDir = path.join(nm, scope)
      const pkgs = scope.startsWith('@') ? listDirs(scopeDir).map((n) => [scope + '/' + n, path.join(scopeDir, n)]) : [[scope, scopeDir]]
      for (const [full, dir] of pkgs) {
        if (OURS.packages.includes(full)) continue
        const claims = claimsOf(dir)
        if (claims.length) found.push({ profile: prof, pkg: full, claims })
      }
    }
  }
  return found
}

/** 已挂载的包名（profile patch 的 name: 行 + agent preset 的 name: 行）——只有挂载了才可能真撞 */
export function mountedNames() {
  const names = new Set()
  const grab = (file) => {
    const t = readText(file)
    for (const m of t.matchAll(/^\s*-?\s*name:\s*['"]?([^'"\s]+)['"]?\s*$/gm)) names.add(m[1])
  }
  const profilesDir = path.join(home, 'profiles')
  for (const prof of listDirs(profilesDir)) grab(path.join(profilesDir, prof, 'cordis.patch.yml'))
  const presetsDir = path.join(home, '.agent-presets')
  for (const p of listDirs(presetsDir)) {
    const dir = path.join(presetsDir, p)
    for (const f of (() => { try { return readdirSync(dir) } catch { return [] } })()) {
      if (/\.ya?ml$/.test(f)) grab(path.join(dir, f))
    }
  }
  return names
}

function patchInfo() {
  const out = []
  for (const prof of listDirs(path.join(home, 'profiles'))) {
    const f = path.join(home, 'profiles', prof, 'cordis.patch.yml')
    const t = readText(f)
    if (!t) continue
    const ids = [...t.matchAll(/^\s*-\s*id:\s*([A-Za-z0-9_.\-]+)/gm)].map((m) => m[1])
    const dup = ids.filter((x, i) => ids.indexOf(x) !== i)
    out.push({ profile: prof, ids, duplicates: [...new Set(dup)], hasOurs: ids.some((x) => OURS.loaderIds.includes(x)) })
  }
  return out
}

function main() {
  const problems = []
  const notes = []
  const installed = scanInstalled()
  const patches = patchInfo()

  for (const p of patches) {
    if (p.duplicates.length) problems.push('profile ' + p.profile + '：cordis.patch.yml 里重复的 loader id —— ' + JSON.stringify(p.duplicates) + '（宿主会报 duplicate loader entry id 并拒绝启动，删掉重复那条即可）')
  }
  const mounted = mountedNames()
  const diskOnly = []
  for (const hit of installed) {
    if (mounted.has(hit.pkg)) {
      problems.push('冲突：' + hit.pkg + ' 已挂载（profile ' + hit.profile + '）且声明了同一批名字 → ' + hit.claims.join(', ')
        + '。段名同层重名 = 宿主装配报错；命令名重名 = 后注册的抢不到。修法：二选一 —— 把它从同一平面摘掉，或让我们用 ./global 入口（自有段名，不占官方槽位）。')
    } else {
      diskOnly.push(hit.pkg + '（' + hit.claims.length + ' 项同名声明）')
    }
  }
  if (diskOnly.length) notes.push('盘里躺着但**没挂载**的同类包（不影响运行，挂上去才会撞）：' + [...new Set(diskOnly)].join('、'))
  const cfgDirNew = path.join(home, 'whale-persona')
  const cfgDirOld = path.join(home, 'whale-suite')
  const cfgPath = existsSync(path.join(cfgDirOld, 'config.json')) ? path.join(cfgDirOld, 'config.json') : path.join(cfgDirNew, 'config.json')
  notes.push('配置真源：' + cfgPath.replace(/\\/g, '/') + (existsSync(path.join(cfgDirOld, 'config.json')) ? '（旧布局 whale-suite）' : '（新布局 whale-persona）'))
  notes.push('我们占的名字：段 ' + OURS.sections.length + ' 个、命令 ' + OURS.commands.join('/') + '、loader id ' + OURS.loaderIds.join('/') + '、agent preset ' + OURS.preset)
  notes.push('已装插件里声明同名段/命令的其它包：' + (installed.length ? installed.map((x) => x.pkg).join(', ') : '无'))
  if (existsSync(path.join(cfgDirOld, 'presets')) && existsSync(path.join(cfgDirNew, 'presets'))) notes.push('两个预设目录同时存在（whale-suite 与 whale-persona）：读的是 whale-suite（旧布局优先），别把新卡放进另一个')

  const payload = { home, patches, installed, notes, problems }
  if (asJson) console.log(JSON.stringify(payload, null, 2))
  else {
    console.log('共存体检（' + home.replace(/\\/g, '/') + '）')
    console.log('')
    for (const n of notes) console.log('· ' + n)
    console.log('')
    if (problems.length) { console.log('发现 ' + problems.length + ' 处要注意：'); for (const p of problems) console.log('  ! ' + p) }
    else console.log('没发现冲突级问题：没有别的插件抢我们的段名/命令名，也没有重复的 loader id。')
    console.log('')
    console.log('背景：本插件**故意**遮蔽官方 @deepseek-ai/dsh-persona 在 deployment 层注册的 persona 段（跨层遮蔽 = 官方机制），')
    console.log('      所以「和官方人设冲突」是设计目的，不是 bug；真正的风险只有「同一层里还有人注册同名段」与「重复 loader id」。')
  }
  if (problems.length) process.exitCode = 1
}

if (process.argv[1] && process.argv[1].endsWith('doctor.mjs')) main()
