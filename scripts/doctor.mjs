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
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

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

/**
 * 上游接口指纹（0.16.0 新增，2026-09-22）—— 回答另一个具体担心：
 * 「DSH 哪天更新了，我们会不会悄悄不适配？」
 *
 * 做法：直接扫**本机装的 DSH 源码**，看我们依赖的接口还在不在。
 * 这不是"猜上游会不会改"，而是"现在这一版上游里，我们踩的那几个点还在不在"——
 * 上游一升级，跑一遍就知道哪一条先断，不用等会话出问题。
 *
 * 为什么扫 node_modules/@deepseek-ai/*：DSH 主包自己是**壳子**（无源码），实现在几十个子包里。
 * 本机实测：844 个候选文件、枚举约 2.4 秒、5 个模式全扫完 —— 够快，所以放在体检里默认跑。
 * 判据是**文本包含**，不是语义理解：它只回答"这个字符串还在不在源码里"，
 * 属于「证据级提示」而不是「断言级结论」——命中了不代表接口没改语义，没命中一定值得看一眼。
 */
export const UPSTREAM_DEPS = [
  { pattern: 'deployment:persona-prefix', what: '我们占的官方段名（跨层遮蔽靠它）' },
  { pattern: 'whale:thinking-language', what: '自有段名（不该在上游出现，命中=撞名风险）', expectAbsent: true },
  { pattern: 'systemPrompt', what: 'ctx.systemPrompt.section() 注册段的服务名' },
  { pattern: 'agent/pre-step', what: '条件反射层挂的事件名' },
  { pattern: 'agent/request', what: '条件反射层挂的事件名' },
  { pattern: 'tools.restrict', what: '步级工具裁剪用的 API（reflex 可选层）' },
  { pattern: 'applyChildComposition', what: '子代理继承父会话 preset 组装的函数（人设传给子代理靠它）' },
]

function walkFiles(dir, out, depth = 0) {
  if (depth > 3) return out
  let names = []
  try { names = readdirSync(dir) } catch { return out }
  for (const n of names) {
    if (n === 'node_modules' && depth > 0) continue
    const p = path.join(dir, n)
    let st = null
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walkFiles(p, out, depth + 1)
    else if (/\.(js|mjs|cjs)$/.test(n) && st.size < 3 * 1024 * 1024) out.push(p)
  }
  return out
}

/** 找本机装的 DSH 主包（认包名，不认路径） */
export function findDsh() {
  const cands = []
  const add = (p) => { if (p) cands.push(p) }
  add(process.env.DSH_INSTALL)
  if (process.env.APPDATA) add(path.join(process.env.APPDATA, 'npm', 'node_modules', '@deepseek-ai', 'dsh'))
  if (process.env.LOCALAPPDATA) add(path.join(process.env.LOCALAPPDATA, 'npm', 'node_modules', '@deepseek-ai', 'dsh'))
  try { add(path.join(process.execPath, '..', '..', 'lib', 'node_modules', '@deepseek-ai', 'dsh')) } catch { /* 正常 */ }
  for (const p of cands) {
    const t = readText(path.join(p, 'package.json'))
    if (!t) continue
    try {
      const j = JSON.parse(t)
      if (j.name === '@deepseek-ai/dsh') return { dir: p, version: j.version }
    } catch { /* 坏 json */ }
  }
  return null
}

/** 扫上游源码，报每个依赖点的命中情况 */
export function upstreamProbe(dshDir) {
  const nm = path.join(dshDir, 'node_modules', '@deepseek-ai')
  let subdirs = []
  try { subdirs = readdirSync(nm).filter((n) => { try { return statSync(path.join(nm, n)).isDirectory() } catch { return false } }) }
  catch { return { scanned: 0, hits: [], error: '读不到 ' + nm } }
  const files = []
  for (const d of subdirs) walkFiles(path.join(nm, d), files)
  const hits = UPSTREAM_DEPS.map((dep) => {
    const found = []
    for (const f of files) {
      const t = readText(f)
      if (t && t.includes(dep.pattern)) { found.push(path.relative(dshDir, f).replace(/\\/g, '/')); if (found.length >= 3) break }
    }
    return { pattern: dep.pattern, what: dep.what, expectAbsent: !!dep.expectAbsent, files: found }
  })
  return { scanned: files.length, subpackages: subdirs.length, hits }
}

/** 候选项：本机可能装了多套 DSH home，各自 profile 里都声明本插件、版本还各不相同
 *  （2026-09-22 实测：同机两套，一套 0.15.0、一套 0.11.4）。
 *  这里**只按名字特征去发现**，不写死任何具体路径 —— 写死别人的私有目录既无用也不该进包。
 *  成本实测：磁盘根目录第一层枚举 D:\ 70 项 41ms、C:\ 21 项 2ms，可忽略。 */
export function candidateHomes() {
  const cands = []
  const push = (p) => { if (!p) return; const n = path.resolve(p); if (!cands.includes(n)) cands.push(n) }
  push(process.env.DSH_HOME)
  push(path.join(os.homedir(), '.dsh'))
  // 再扫各盘根目录第一层，挑名字里带 dsh 的目录（如 .dsh 或用户自取的 dsh 目录名）
  const roots = []
  for (const drv of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const r = drv + ':/'
    try { if (statSync(r).isDirectory()) roots.push(r) } catch { /* 该盘不存在 */ }
  }
  for (const r of roots) {
    for (const d of listDirs(r)) {
      if (!/dsh/i.test(d)) continue
      push(path.join(r, d))
    }
  }
  return cands.filter((p) => existsSync(path.join(p, 'profiles')))
}

/** 本机插件版本与挂载渠道（npx / npm / tarball / junction / link）。
 *  必须把 link: 解析到的**真实目录**与版本一起报出来 —— 只报版本号会让人以为看到的是自己那份代码。 */
export function installInfo() {
  const out = []
  for (const base of candidateHomes()) {
    const profilesDir = path.join(base, 'profiles')
    for (const prof of listDirs(profilesDir)) {
      const dir = path.join(profilesDir, prof)
      const pkg = (() => { try { return JSON.parse(readText(path.join(dir, 'package.json')) || '{}') } catch { return {} } })()
      const deps = pkg.dependencies || {}
      for (const [name, spec] of Object.entries(deps)) {
        if (!name.includes('whale-persona')) continue
        const modDir = path.join(dir, 'node_modules', name)
        const specStr = String(spec)
        // link:/file: 的目标目录（可能是另一个开发树）—— 解析出来，别只报版本
        let target = ''
        const m = /^(?:link|file):(.+)$/.exec(specStr)
        if (m) {
          const raw = m[1].trim()
          target = (/^[A-Za-z]:/.test(raw) ? raw : path.resolve(dir, raw)).replace(/\\/g, '/')
        }
        const readVer = (p) => { try { return JSON.parse(readText(path.join(p, 'package.json'))).version } catch { return '' } }
        const installedVer = readVer(modDir)
        const targetVer = target ? readVer(target) : ''
        let channel = 'npm（已发布包）'
        if (m) channel = 'link/file（本地目录直连）'
        else if (/^https?:|\.tgz$/i.test(specStr)) channel = 'tarball / git 地址'
        out.push({
          home: base, profile: prof, name, spec: specStr, target, targetVersion: targetVer,
          version: installedVer || targetVer || '(读不到)',
          channel, present: existsSync(modDir), targetExists: target ? existsSync(target) : true,
        })
      }
    }
  }
  return out
}

export async function probeRender(coreDir) {
  try {
    const mod = await import('file:///' + coreDir.replace(/\\/g, '/') + '/edit.js')
    const r = mod.renderSections({}, { model: 'flash', cwd: '' })
    return {
      prefix: String(r.prefix || '').length,
      thinking: String(r.thinking || '').length,
      suffix: String(r.suffix || '').length,
      mode: r.mode,
      warnings: r.warnings,
      error: '',
    }
  } catch (e) {
    return { error: String((e && e.message) || e), prefix: null, thinking: null, suffix: null, mode: '', warnings: [] }
  }
}

/** 版本哨兵：一次性回答「上游变了吗、我们装的还是不是最新的、三段还对不对」 */
export async function versionSentinel() {
  const dsh = findDsh()
  const probe = dsh ? upstreamProbe(dsh.dir) : null
  const installs = installInfo()
  const coreDir = path.join(ROOT, 'core')
  const render = await probeRender(coreDir)
  const dev = (() => { try { return JSON.parse(readText(path.join(ROOT, 'package.json')) || '{}').version } catch { return '' } })()
  const notes = []
  const problems = []

  if (!dsh) notes.push('没找到本机 DSH 主包（可用 DSH_INSTALL 指定路径）—— 跳过上游接口探测')
  if (probe && !probe.error) {
    const missing = probe.hits.filter((h) => !h.expectAbsent && !h.files.length)
    const collided = probe.hits.filter((h) => h.expectAbsent && h.files.length)
    for (const m of missing) problems.push('上游源码里找不到「' + m.pattern + '」（' + m.what + '）—— 上游可能改了接口，先看 docs/上游耦合点与迁移手册 里对应的降级行为与改法')
    for (const c of collided) notes.push('自有段名「' + c.pattern + '」在上游源码里也出现（' + c.files.join(', ') + '）—— 可能是撞名，看一眼')
  }
  if (render.error) problems.push('三段渲染实测失败：' + render.error)
  else if (render.prefix !== 0 || render.thinking !== 0 || render.suffix !== 0) {
    problems.push('「装上零行为改变」被破坏：发布默认配置下三段长度应为 0/0/0，实测 '
      + render.prefix + '/' + render.thinking + '/' + render.suffix)
  }
  for (const it of installs) {
    if (!it.present) problems.push('profile ' + it.profile + ' 声明了 ' + it.name + ' 但目录不存在（挂载会失败）')
    if (dev && String(it.version) !== dev && !String(it.spec).startsWith('link:')) {
      notes.push('profile ' + it.profile + ' 装的是 ' + it.name + '@' + it.version + '，开发本体是 ' + dev + ' —— 版本不一致（link 安装时属正常）')
    }
  }
  return { dsh, devVersion: dev, probe, installs, render, notes, problems }
}

async function main() {
  const problems = []
  const notes = []
  const sentinel = await versionSentinel()
  for (const n of sentinel.notes) notes.push(n)
  for (const p of sentinel.problems) problems.push(p)
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

  const payload = { home, dsh: sentinel.dsh, devVersion: sentinel.devVersion, upstream: sentinel.probe, installs: sentinel.installs, render: sentinel.render, patches, installed, notes, problems }
  if (asJson) console.log(JSON.stringify(payload, null, 2))
  else {
    const line = (s) => console.log(s)
    line('共存体检 + 版本哨兵（' + home.replace(/\\/g, '/') + '）')
    line('')
    line('· 宿主 DSH：' + (sentinel.dsh ? sentinel.dsh.version + '（' + sentinel.dsh.dir.replace(/\\/g, '/') + '）' : '未找到（可用 DSH_INSTALL 指定）'))
    line('· 本插件开发本体：' + (sentinel.devVersion || '?'))
    const activeHome = path.resolve(home)
    const byHome = new Map()
    for (const it of sentinel.installs) {
      if (!byHome.has(it.home)) byHome.set(it.home, [])
      byHome.get(it.home).push(it)
    }
    if (!sentinel.installs.length) line('· 没有 profile 声明本插件（还没装，或在别的 DSH_HOME 下）')
    for (const [h, items] of byHome) {
      line('· DSH_HOME ' + h + (h === activeHome ? '（当前会话用的这份）' : '（另一套，不是当前会话）'))
      for (const it of items) {
        line('    profile ' + it.profile + '：' + it.name + '@' + it.version + '  渠道=' + it.channel + (it.present ? '' : '  ⚠ 目录不存在'))
        if (it.target) {
          line('      → ' + it.target + (it.targetExists ? '' : '  ⚠ 目标不存在')
            + (it.targetVersion && it.targetVersion !== sentinel.devVersion ? '（该目录是 ' + it.targetVersion + '，不是本开发树 ' + sentinel.devVersion + '）' : ''))
        }
      }
    }
    if (byHome.size > 1) line('  ⚠ 本机有多套 DSH_HOME 且都装了本插件 —— 改代码后要确认自己看的是哪一套（`dsh web` 用哪个端口/profile，看它的启动脚本里的 DSH_HOME）')
    const r = sentinel.render
    line('· 三段实测（发布默认配置）：人设 ' + (r.error ? 'ERR' : r.prefix + ' 字符') + ' / 思考语言 ' + (r.error ? 'ERR' : r.thinking + ' 字符') + ' / 末尾 ' + (r.error ? 'ERR' : r.suffix + ' 字符') + '  ⇒ ' + (r.error ? r.error : (r.prefix === 0 && r.thinking === 0 && r.suffix === 0 ? '零行为改变成立' : '零行为改变被破坏!'))) 
    if (sentinel.probe && !sentinel.probe.error) {
      line('· 上游接口探测：扫了 ' + sentinel.probe.scanned + ' 个文件 / ' + sentinel.probe.subpackages + ' 个子包')
      for (const h of sentinel.probe.hits) {
        const mark = h.expectAbsent ? (h.files.length ? '  ⚠ 撞名?' : '  ok 未出现') : (h.files.length ? '  ok' : '  ✗ 找不到')
        line('    ' + mark + '  ' + h.pattern + (h.files.length ? '（' + h.files.slice(0, 2).join(', ') + '）' : '') + ' —— ' + h.what)
      }
    }
    line('')
    for (const n of notes) line('· ' + n)
    line('')
    if (problems.length) { line('发现 ' + problems.length + ' 处要注意：'); for (const p of problems) line('  ! ' + p) }
    else line('没发现冲突级问题：没有别的插件抢我们的段名/命令名，也没有重复的 loader id，上游接口点也都在。')
    line('')
    line('背景：本插件**故意**遮蔽官方 @deepseek-ai/dsh-persona 在 deployment 层注册的 persona 段（跨层遮蔽 = 官方机制），')
    line('      所以「和官方人设冲突」是设计目的，不是 bug；真正的风险只有「同一层里还有人注册同名段」与「重复 loader id」。')
    line('      上游接口探测是**文本包含**级证据：命中不代表语义没改，没命中一定值得看一眼（见 docs/上游耦合点与迁移手册.md）。')
  }
  if (problems.length) process.exitCode = 1
}

if (process.argv[1] && process.argv[1].includes('doctor.mjs')) main()
