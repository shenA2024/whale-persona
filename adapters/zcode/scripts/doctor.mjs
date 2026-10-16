#!/usr/bin/env node
/**
 * ZCode 侧自检（只读 · 零依赖 · 不写任何文件）—— 0.18.1 新增。
 *
 * 为什么有它（触发来源 2026-10-16）：ZCode 适配器解冻后，"装上了但不确定 hook 有没有真的跑"
 * 需要一条可复核的判据。ZCode 把插件状态分散在三处（marketplace 登记 / 插件缓存 / 宿主日志），
 * 靠人翻目录容易看错，所以把读数收进一条命令：
 *
 *   node <插件目录>/scripts/doctor.mjs
 *
 * 它回答四个问题，每问都只报"读到了什么"，不猜：
 *   ① 这台 ZCode 客户端什么版本（只读 app.asar 头部，不解整个包）
 *   ② 我们的 marketplace 登记了没有、插件缓存里有没有 whale-persona（装没装）
 *   ③ hook 会读到哪一份 config（定位链与 DSH 侧同一套），里面有没有填人设
 *   ④ 当天的宿主日志里，hook 通道与 hook 记录有没有出现（**只报命中行原文**，
 *      不硬判 fired / failed —— 日志格式属于宿主实现，本脚本不为它背书）
 *
 * 纪律：只读；路径不存在就报"没读到"，异常一律降级为空读数，绝不打断或改写任何东西。
 */
import { closeSync, existsSync, openSync, readFileSync, readdirSync, readSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const argv = process.argv.slice(2)
function arg(name, fallback = '') {
  const i = argv.indexOf('--' + name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

const home = path.resolve(arg('home', process.env.USERPROFILE || os.homedir()))
// 不猜安装路径：把作者本机的路径写进公开仓既没用、又算环境信息外泄。
// --app 显式给，或读环境变量 ZCODE_APP_DIR；两个都没有就跳过 ① 那一项并提示怎么给。
const appArg = arg('app', String(process.env.ZCODE_APP_DIR || '').trim())
const appDir = appArg ? path.resolve(appArg) : ''
const today = new Date()
const day = arg('day', today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0'))

const out = []
const say = (s) => out.push(s)

/** 只读 asar 头部的 package.json —— 不整读（本机 app.asar 324 MB） */
function asarPackage(asarPath) {
  if (!existsSync(asarPath)) return null
  let fd = -1
  try {
    fd = openSync(asarPath, 'r')
    const head = Buffer.alloc(16)
    readSync(fd, head, 0, 16, 0)
    const headerSize = head.readUInt32LE(12)
    if (!headerSize || headerSize > 64 * 1024 * 1024) return null
    const hb = Buffer.alloc(headerSize)
    readSync(fd, hb, 0, headerSize, 16)
    const entry = (JSON.parse(hb.toString('utf8')).files || {})['package.json']
    if (!entry) return null
    const data = Buffer.alloc(entry.size)
    readSync(fd, data, 0, entry.size, 16 + headerSize + parseInt(entry.offset, 10))
    const pkg = JSON.parse(data.toString('utf8'))
    return { name: pkg.name || '', version: pkg.version || '' }
  } catch { return null } finally { if (fd >= 0) { try { closeSync(fd) } catch { /* 已关 */ } } }
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
}

// ── ① 客户端版本 ────────────────────────────────────────────────────────────────
say('① ZCode 客户端')
if (!appDir) {
  say('   没给安装目录 —— 用 `--app <ZCode 安装目录>`（ZCode.exe 所在那一层）或环境变量 `ZCODE_APP_DIR`；这一项先跳过。')
} else {
  const asar = path.join(appDir, 'resources', 'app.asar')
  const pkg = asarPackage(asar)
  if (pkg) say('   ' + (pkg.name || '(无 name)') + ' ' + pkg.version + '   ← ' + asar)
  else say('   没读到 ' + asar + '（换一个 --app 目录再试）')
}

// ── ② 装没装 ───────────────────────────────────────────────────────────────────
say('② 插件安装状态')
const cliDir = path.join(home, '.zcode', 'cli')
const mpFile = path.join(cliDir, 'plugins', 'known_marketplaces.json')
const mp = readJson(mpFile)
if (!mp || !Array.isArray(mp.marketplaces)) {
  say('   没读到 marketplace 登记：' + mpFile)
} else {
  const ours = mp.marketplaces.filter((m) => JSON.stringify(m.source || {}).toLowerCase().includes('whale-persona'))
  say('   已登记 marketplace：' + mp.marketplaces.map((m) => m.id).join(', '))
  say(ours.length
    ? '   其中指向本仓的：' + ours.map((m) => m.id + ' ← ' + JSON.stringify(m.source)).join(' · ')
    : '   ⚠ 没有任何 marketplace 指向 whale-persona 仓（Discover 里 + 一次，来源填仓目录或仓库 URL）')
}
const cacheRoot = path.join(cliDir, 'plugins', 'cache')
let installed = []
try {
  for (const m of readdirSync(cacheRoot, { withFileTypes: true })) {
    if (!m.isDirectory()) continue
    const p = path.join(cacheRoot, m.name, 'whale-persona')
    if (!existsSync(p)) continue
    for (const v of readdirSync(p, { withFileTypes: true })) {
      if (!v.isDirectory()) continue
      const dir = path.join(p, v.name)
      installed.push({
        dir,
        manifest: existsSync(path.join(dir, '.zcode-plugin', 'plugin.json')),
        hooks: existsSync(path.join(dir, 'hooks', 'hooks.json')),
        core: existsSync(path.join(dir, 'vendor', 'core', 'render.js')),
        version: (readJson(path.join(dir, '.zcode-plugin', 'plugin.json')) || {}).version || v.name,
      })
    }
  }
} catch { /* 没装过：cache 目录可能不存在 */ }
if (!installed.length) {
  say('   ⚠ 插件缓存里没有 whale-persona：' + path.join(cacheRoot, '<marketplace>', 'whale-persona', '<版本>'))
} else {
  for (const it of installed) {
    say('   ✓ 已装 ' + it.dir)
    say('     清单 .zcode-plugin/plugin.json = ' + it.manifest + ' · hooks/hooks.json = ' + it.hooks
      + ' · vendor/core = ' + it.core + ' · 版本 = ' + it.version)
  }
}

// ── ③ hook 会读到哪一份 config（与 hooks/render.mjs 同一套定位链）────────────────
say('③ hook 读到的配置')
const dshHome = process.env.DSH_HOME && process.env.DSH_HOME.trim() ? process.env.DSH_HOME.trim() : path.join(home, '.dsh')
const chain = [
  ['$WHALE_PERSONA_CONFIG', process.env.WHALE_PERSONA_CONFIG],
  ['$DSH_WHALE_CONFIG', process.env.DSH_WHALE_CONFIG],
  ['$DSH_HOME/whale-persona/config.json', path.join(dshHome, 'whale-persona', 'config.json')],
  ['$DSH_HOME/whale-suite/config.json', path.join(dshHome, 'whale-suite', 'config.json')],
  ['~/.whale-persona/config.json', path.join(home, '.whale-persona', 'config.json')],
]
const hit = chain.find(([, p]) => p && existsSync(p))
if (!hit) {
  say('   定位链一个都没命中（纯 ZCode 用户放 ~/.whale-persona/config.json；想与 DSH 共用就放 ' + path.join(dshHome, 'whale-persona', 'config.json') + '）')
} else {
  const cfg = readJson(hit[1])
  const who = [cfg && cfg.persona && cfg.persona.character, cfg && cfg.persona && cfg.persona.selfName, cfg && cfg.user && cfg.user.name]
    .map((x) => String(x || '').trim())
    .filter(Boolean)
  say('   命中 ' + hit[0] + ' → ' + hit[1])
  say('   人设段' + (cfg && cfg.persona && String(cfg.persona.character || '').trim() ? '**有内容**（长度 ' + String(cfg.persona.character).length + '）' : '为空 —— 装上也不会有可见效果（这是设计：默认零行为改变）')
    + (who.length ? ' · 自称/称呼等已填 ' + who.length + ' 项' : ''))
}

// ── ④ 当天日志里的 hook 痕迹（只报命中行，不替宿主判 fired/failed）──────────────
say('④ 当天日志（' + day + '）')
const logFile = path.join(home, '.zcode', 'v2', 'logs', day + '.log')
if (!existsSync(logFile)) {
  say('   没读到 ' + logFile + '（用 --day YYYY-MM-DD 换一天）')
} else {
  let lines = []
  try { lines = readFileSync(logFile, 'utf8').split(/\r?\n/) } catch { lines = [] }
  const runner = lines.filter((l) => /channel "hooks"/.test(l))
  // 别只按 "whale-persona" 字样找：宿主写执行记录时用的措辞是它的实现细节（可能是插件 id、
  // 可能是脚本路径、也可能只有 "hook"）。所以分成三层报：注册行 → 其它含 hook 的行 → 其中点名本插件的。
  const hookish = lines.filter((l) => /hook/i.test(l) && !/channel "hooks"/.test(l))
  const mine = hookish.filter((l) => /(whale-persona|render\.mjs|UserPromptSubmit)/i.test(l))
  say('   文件 ' + logFile + '（' + Math.round(statSync(logFile).size / 1024) + ' KB，' + lines.length + ' 行）')
  say('   运行器通道注册（channel "hooks"）：' + runner.length + ' 条' + (runner.length ? '' : ' —— 没见到说明 hook 运行器没起（至少要先装一个带 hook 的插件）'))
  say('   其它含 hook 的日志行：' + hookish.length + ' 条 · 其中点名本插件的：' + mine.length + ' 条')
  for (const l of (mine.length ? mine : hookish).slice(-5)) say('     · ' + l.slice(0, 200))
  if (!mine.length && !hookish.length) {
    say('   ⚠ v2 侧还没有 hook 执行痕迹 —— 装完要**新开一个会话、发一句**，hook 才有机会跑（装之前开着的会话不一定重载）。')
  } else {
    say('   ↑ 原文照抄，fired / failed 以宿主写的字样为准；本脚本不替它判定。')
  }
  // hook 阶段真正的执行记录在 **agent 侧**日志里（~/.zcode/cli/log/zcode-<日期>.jsonl）：
  // turn.phase.* 事件的 context.phase === "user_prompt_hooks"（本机 2026-10-16 实测：
  // 装插件之前那次是 durationMs:0 —— 当时没有任何 hook 注册，阶段空跑完成）。
  // 所以判据是**这一层的 durationMs > 0**；v2/logs 那边看不到它。
  const cliLog = path.join(cliDir, 'log', 'zcode-' + day + '.jsonl')
  if (!existsSync(cliLog)) {
    say('   agent 侧日志：没读到 ' + cliLog)
  } else {
    let rows = []
    try { rows = readFileSync(cliLog, 'utf8').split(/\r?\n/).filter(Boolean) } catch { rows = [] }
    const phases = []
    for (const r of rows) {
      if (!r.includes('user_prompt_hooks')) continue
      try {
        const o = JSON.parse(r)
        if (o && o.context && o.context.phase === 'user_prompt_hooks') phases.push(o)
      } catch { /* 坏行跳过 */ }
    }
    const fired = phases.filter((o) => Number(o.durationMs) > 0)
    say('   agent 侧 ' + path.basename(cliLog) + '：user_prompt_hooks 阶段 ' + phases.length + ' 条'
      + ' · 耗时 > 0 的 ' + fired.length + ' 条（这一项**不足以**判定 hook 跑没跑，见下）')
    for (const o of phases.slice(-3)) {
      say('     · ' + (o.timestamp || '') + ' ' + (o.event || '') + ' status=' + (o.status || '')
        + ' durationMs=' + (o.durationMs === undefined ? '?' : o.durationMs)
        + ' turn=' + (o.context && o.context.turnNumber !== undefined ? o.context.turnNumber : '?'))
    }
    if (phases.length && !fired.length) say('   ⚠ 这个阶段出现过、但耗时全是 0 —— 当时没有 hook 在注册（多半是装插件之前的会话）。')
    // 别把 durationMs > 0 当 fired 的判据：本机 2026-10-16 实测，装插件**之前**的会话里也有一条
    // durationMs=1 的记录（这个阶段本身就有开销），拿它下结论就是假阳性。
    // 所以这里只摆读数，判定留给"两层里出现点名本插件的记录"或宿主自己写的 fired / failed 字样。
    if (fired.length) {
      say('   注：上面 ' + fired.length + ' 条 > 0 的**不能**当作 fired 的证据（本机实测：装插件之前也有 durationMs=1 的阶段）。')
      say('       真判据是前面两层里出现点名本插件的记录，或宿主写出 fired / failed 字样。')
    }
  }
}

// ── ⑤ 运行环境：hook 的 `command: "node"` 找不找得到 ────────────────────────────
say('⑤ 运行环境（hooks.json 用 type:"process" ＋ command:"node"）')
const exeDir = path.dirname(process.execPath)
const pathDirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean)
const sameDir = (a, b) => {
  try { return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() } catch { return false }
}
const onPath = pathDirs.some((d) => sameDir(d, exeDir))
const major = Number(String(process.versions.node).split('.')[0])
say('   node ' + process.version + (major >= 20 ? '（≥ 20 ✓）' : '（**低于 20**，本插件要求 Node ≥ 20）'))
say('   当前解释器：' + process.execPath)
if (onPath) {
  say('   它所在目录在 PATH 里 ✓ —— `command:"node"` 能解析到（ZCode 继承的是**用户/机器级** PATH，')
  say('   所以这一项要在没被 shell 临时改过 PATH 的环境里看才准）。')
} else {
  say('   ⚠ 它所在目录**不在** PATH 里 —— hook 的 `command:"node"` 可能解析不到（症状：日志里这条 hook failed）。')
  say('     两个改法任选：① 把 node 的目录加进用户级 PATH；② 把 hooks/hooks.json 的 command 改成上面的绝对路径。')
}

say('')
say('结论口径：② 已装 ＋ ④ 有 hook 行 = 这一侧可以用；② 未装 → 去 ZCode 设置 → 插件管理 → Discover → + 添加本仓。')
console.log(out.join('\n'))
