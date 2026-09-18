#!/usr/bin/env node
/**
 * whale-persona —— DSH 一条命令安装器
 *
 * 为什么需要它（2026-09-18 在干净 DSH_HOME 上实测踩出来的三条）：
 *   ① dsh plugin add github:user/repo 在这个 monorepo 布局下装不上：profile 的 pnpm workspace 拒收裸 add、
 *      pnpm 把 github: 展开成 ssh、pnpm 不支持子目录 git 依赖、仓库根原本没有 package.json；
 *   ② 人设行必须挂 agent preset 平面，挂 profile 平面会让整个插件树加载失败（prompt section already registered）；
 *   ③ 装完不设默认 preset，用户看到的还是官方默认人设。
 * 本脚本把「装包 + 建 preset + 设默认 + 拷技能 + 自检」压成一条命令。
 *
 * 用法（在克隆下来的仓库根）：
 *   node scripts/install-dsh.mjs                 # 装进 profile web（默认）
 *   node scripts/install-dsh.mjs --profile lab   # 指定 profile
 *   node scripts/install-dsh.mjs --link          # 不复制，直接链当前仓库（开发用，改代码即时生效）
 *   node scripts/install-dsh.mjs --base ptc      # 指定基座 preset（默认 auto = 跟随用户当前的默认 preset）
 *   node scripts/install-dsh.mjs --no-default    # 不动用户已有的默认 preset 设置
 *   node scripts/install-dsh.mjs --dry-run       # 只打印将要做的事
 *
 * 幂等：重复运行只补缺的部分，不覆盖用户既有设置。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SOURCE = path.resolve(HERE, '..')
const PERSONA_PKG = '@shenA2024/whale-persona'
const UI_PKG = '@shenA2024/whale-persona-ui'
const PRESET_ID = 'whale-persona'
const PRESET_NAME = '自定义人设'
const SELF = 'whale-persona:'

const argv = process.argv.slice(2)
const opts = { profile: 'web', link: false, home: '', source: SOURCE, setDefault: true, base: 'auto', dry: false, help: false }
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--profile') opts.profile = String(argv[++i] || 'web')
  else if (a === '--home') opts.home = String(argv[++i] || '')
  else if (a === '--source') opts.source = path.resolve(String(argv[++i] || SOURCE))
  else if (a === '--link') opts.link = true
  else if (a === '--base') opts.base = String(argv[++i] || 'auto')
  else if (a === '--no-default') opts.setDefault = false
  else if (a === '--dry-run') opts.dry = true
  else if (a === '-h' || a === '--help') opts.help = true
  else { console.error(SELF + ' unknown argument: ' + a); process.exit(2) }
}

const HOME = opts.home || process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const PROFILE_DIR = path.join(HOME, 'profiles', opts.profile)
const TARGET = opts.link ? opts.source : path.join(HOME, 'plugins', PRESET_ID)
const SKIP_DIRS = new Set(['.git', 'node_modules', 'out', '.tmp', 'research', '.github'])

const log = (m) => console.log(SELF + ' ' + m)
const warn = (m) => console.warn(SELF + ' ! ' + m)
const fail = (m) => { console.error(SELF + ' ' + m); process.exitCode = 1 }

function run(args, quiet) {
  const env = Object.assign({}, process.env)
  env.DSH_HOME = HOME
  const stdio = quiet ? 'pipe' : 'inherit'
  if (process.platform !== 'win32') {
    return spawnSync('dsh', args, { stdio, env, encoding: 'utf8' })
  }
  // Windows：dsh 是 .cmd 垫片，只能走 shell；参数拼成一条字符串（数组 + shell 会触发 DEP0190）
  const line = 'dsh ' + args.map((a) => (/[\s"]/.test(a) ? '"' + a.replace(/"/g, '\\"') + '"' : a)).join(' ')
  return spawnSync(line, { stdio, env, encoding: 'utf8', shell: true })
}

function main() {
  if (opts.help) return printHelp()
  log('DSH_HOME   = ' + HOME)
  log('profile    = ' + opts.profile)
  log('source     = ' + opts.source)
  log('install to = ' + TARGET + (opts.link ? '   (link: 直接用当前仓库)' : '   (copy)'))
  if (!existsSync(path.join(opts.source, 'adapters', 'dsh', 'index.js'))) {
    return fail('这个目录不像 whale-persona 仓库：' + opts.source)
  }
  ensureProfile()
  if (!opts.dry) copyTree()
  installPackage(PERSONA_PKG)
  installPackage(UI_PKG, path.join('adapters', 'dsh-ui'))
  writePreset()
  patchProfileRow()
  if (opts.setDefault) setDefaultPreset()
  copySkill()
  verify()
  printNext()
}

function printHelp() {
  const head = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]
  console.log(head.replace(/^\/\*\*?/, '').replace(/^ \* ?/gm, ''))
}

function ensureProfile() {
  if (existsSync(path.join(PROFILE_DIR, 'package.json'))) { log('profile 已存在：' + PROFILE_DIR); return }
  log('profile 不存在，用宿主自带的 web 模版创建：' + PROFILE_DIR)
  if (opts.dry) return
  const r = run(['--profile', opts.profile, '--from-default-profile', 'web', '--dump-config'], true)
  if (r.status !== 0) fail('创建 profile 失败：' + String(r.stderr || '').trim().split('\n').slice(0, 2).join(' | '))
}

function copyTree() {
  if (opts.link) return
  if (path.resolve(opts.source) === path.resolve(TARGET)) { log('源与目标相同，跳过复制'); return }
  log('复制仓库到 ' + TARGET)
  rmSync(TARGET, { recursive: true, force: true })
  mkdirSync(path.dirname(TARGET), { recursive: true })
  cpSync(opts.source, TARGET, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(opts.source, src)
      if (!rel) return true
      return !SKIP_DIRS.has(rel.split(path.sep)[0])
    },
  })
}

function installPackage(pkgName, sub) {
  const dir = sub ? path.join(TARGET, sub) : TARGET
  const spec = 'link:' + dir.split(path.sep).join('/')
  log('安装 ' + pkgName + '  ->  ' + spec)
  if (opts.dry) return
  const r = run(['plugin', '--profile', opts.profile, 'add', '-w', spec], true)
  if (r.status !== 0) {
    warn('dsh plugin add 失败，改用手工三件套（package.json + junction）')
    warn(String(r.stderr || r.stdout || '').trim().split('\n').slice(0, 3).join(' | '))
    manualLink(pkgName, sub)
    return
  }
  const out = String(r.stdout || '') + String(r.stderr || '')
  if (out.indexOf('declares no dsh.bundle') >= 0) {
    log('（提示：包没有 dsh.bundle 声明，按普通依赖装、靠挂载行激活——这是预期行为）')
  }
}

function manualLink(pkgName, sub) {
  const pkgJson = path.join(PROFILE_DIR, 'package.json')
  const manifest = JSON.parse(readFileSync(pkgJson, 'utf8'))
  manifest.dependencies = manifest.dependencies || {}
  manifest.dependencies[pkgName] = 'link:' + path.join(TARGET, sub || '').split(path.sep).join('/')
  writeFileSync(pkgJson, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  const linkPath = path.join(PROFILE_DIR, 'node_modules', pkgName)
  mkdirSync(path.dirname(linkPath), { recursive: true })
  rmSync(linkPath, { recursive: true, force: true })
  try {
    symlinkSync(path.join(TARGET, sub || ''), linkPath, 'junction')
    log('junction 已建：' + linkPath)
  } catch (e) { warn('junction 建不了：' + e.message) }
}

function findShippedPreset(name) {
  const root = findShippedPresetsRoot()
  return root ? path.join(root, name) : ''
}

function findShippedPresetsRoot() {
  const rel = path.join('@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-agent-presets', 'presets')
  const roots = []
  if (process.env.DSH_AGENT_PRESETS_ROOT) roots.push(process.env.DSH_AGENT_PRESETS_ROOT)
  if (process.env.APPDATA) roots.push(path.join(process.env.APPDATA, 'npm', 'node_modules'))
  if (process.env.npm_config_prefix) roots.push(path.join(process.env.npm_config_prefix, 'node_modules'))
  const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], { encoding: 'utf8', shell: process.platform === 'win32' })
  if (r.status === 0 && r.stdout) roots.push(r.stdout.trim())
  for (const root of roots) {
    const p = path.join(root, rel)
    if (existsSync(p)) return p
  }
  return ''
}

/** 用户当前的默认 preset id（读 $DSH_HOME/settings.yaml 的 agent-presets.default） */
function defaultPresetId() {
  const file = path.join(HOME, 'settings.yaml')
  if (!existsSync(file)) return ''
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  const idx = lines.findIndex((l) => /^agent-presets:\s*$/.test(l))
  if (idx < 0) return ''
  for (let j = idx + 1; j < lines.length; j++) {
    if (!/^\s+\S/.test(lines[j])) break
    const m = /^\s+default:\s*(\S+)\s*$/.exec(lines[j])
    if (m) return m[1]
  }
  return ''
}

/** 基座目录：用户 preset 优先，其次宿主自带；找不到返回空串 */
function basePresetDir(id) {
  const user = path.join(HOME, '.agent-presets', id)
  if (existsSync(path.join(user, 'agent.cordis.yml'))) return user
  const shippedRoot = findShippedPresetsRoot()
  if (shippedRoot) {
    const shipped = path.join(shippedRoot, id)
    if (existsSync(path.join(shipped, 'agent.cordis.yml'))) return shipped
  }
  return ''
}

/**
 * 基座选择：**跟随用户当前的默认 preset**，不替他选。
 * 为什么不是写死 standard：persona 插件跟"模式"无关，它只是替换掉基座里的人设行；
 * 写死标准模式会把 PTC 用户的能力面悄悄换掉（PTC 走 run_code SDK，标准走逐工具调用）。
 */
function resolveBase() {
  if (opts.base !== 'auto') return { id: opts.base, why: '命令行指定 --base' }
  const cur = defaultPresetId()
  if (cur && cur !== PRESET_ID) return { id: cur, why: '跟随用户当前的默认 preset' }
  if (cur === PRESET_ID) return { id: 'standard', why: '默认 preset 已是本插件（重装），回退宿主出厂默认' }
  return { id: 'standard', why: '用户没设默认 preset，用宿主出厂默认' }
}

function writePreset() {
  const dest = path.join(HOME, '.agent-presets', PRESET_ID)
  const exists = existsSync(path.join(dest, 'agent.cordis.yml'))
  const alreadyOurs = exists && readFileSync(path.join(dest, 'agent.cordis.yml'), 'utf8').indexOf(PERSONA_PKG) >= 0
  if (alreadyOurs) {
    if (!opts.dry) refreshPresetMeta(dest)
    log('preset 已存在，保留它的基座与内容（只补显示名/描述）：' + dest)
    return
  }
  const base = resolveBase()
  const src = basePresetDir(base.id)
  if (!src) {
    warn('找不到基座 preset「' + base.id + '」，preset 没建。手工做法：')
    warn('  1) 把 <宿主 preset 目录>/' + base.id + ' 复制到 ' + dest)
    warn("  2) 把里面  - id: persona / name: '@deepseek-ai/dsh-persona'  那段换成")
    warn('     - id: whale-persona')
    warn("       name: '" + PERSONA_PKG + "'")
    return
  }
  log('基座 preset = ' + base.id + '（' + base.why + '）<- ' + src)
  if (opts.dry) { log('DRY: 建 preset -> ' + dest); return }
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(path.dirname(dest), { recursive: true })
  cpSync(src, dest, { recursive: true })
  swapPersonaRow(path.join(dest, 'agent.cordis.yml'))
  writeFileSync(path.join(dest, 'preset.yml'),
    'name: ' + PRESET_NAME + '\n'
    + 'description: 基于 ' + base.id + ' 模式 + whale-persona 人设引擎（装完即新任务默认；显示名改这一行）\n'
    + 'order: 9\n', 'utf8')
  log('preset 已就绪：' + dest + '   显示名「' + PRESET_NAME + '」')
}

/** 重装时只补元数据：用户改过的显示名不动 */
function refreshPresetMeta(dest) {
  const file = path.join(dest, 'preset.yml')
  const cur = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const hasName = /^name:\s*\S/m.test(cur)
  const hasDesc = /^description:\s*\S/m.test(cur)
  if (hasName && hasDesc) return
  const lines = []
  lines.push(hasName ? /^name:.*$/m.exec(cur)[0] : 'name: ' + PRESET_NAME)
  if (!hasDesc) lines.push('description: whale-persona 人设引擎（装完即新任务默认；显示名改这一行）')
  lines.push('order: 9')
  writeFileSync(file, lines.join('\n') + '\n', 'utf8')
}

function swapPersonaRow(file) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  const out = []
  let swapped = false
  for (let i = 0; i < lines.length; i++) {
    if (!swapped && /^- id: persona\s*$/.test(lines[i])) {
      let j = i + 1
      while (j < lines.length && !/^- /.test(lines[j])) j++
      out.push('- id: whale-persona')
      out.push("  name: '" + PERSONA_PKG + "'")
      if (j < lines.length && lines[j].trim() !== '') out.push('')
      i = j - 1
      swapped = true
      continue
    }
    out.push(lines[i])
  }
  if (!swapped) {
    warn('没在 preset 里找到 - id: persona 行，人设行没替换。手工加：')
    warn("  - id: whale-persona")
    warn("    name: '" + PERSONA_PKG + "'")
  }
  writeFileSync(file, out.join('\n'), 'utf8')
}

function patchProfileRow() {
  const file = path.join(PROFILE_DIR, 'cordis.patch.yml')
  const raw = existsSync(file) ? readFileSync(file, 'utf8') : ''
  if (raw.indexOf(UI_PKG) >= 0) { log('profile patch 已有 UI 行，跳过'); return }
  const block = ['- insert:', '    - id: whale-persona-ui', "      name: '" + UI_PKG + "'"].join('\n')
  const cleaned = raw.replace(/^\s*\[\s*\]\s*$/m, '').trimEnd()
  if (opts.dry) { log('DRY: 追加 profile 行 -> ' + file); return }
  writeFileSync(file, cleaned + '\n\n' + block + '\n', 'utf8')
  log('UI 行已加（设置面板必须在 profile 平面）：' + file)
}

function setDefaultPreset() {
  const file = path.join(HOME, 'settings.yaml')
  const raw = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const lines = raw.split(/\r?\n/)
  const idx = lines.findIndex((l) => /^agent-presets:\s*$/.test(l))
  if (idx >= 0) {
    let j = idx + 1
    let found = -1
    while (j < lines.length && (/^\s+\S/.test(lines[j]) || lines[j].trim() === '')) {
      if (/^\s+default:\s*\S/.test(lines[j])) { found = j; break }
      j++
    }
    if (found >= 0) {
      const cur = lines[found].split(':').slice(1).join(':').trim()
      if (cur && cur !== PRESET_ID) {
        warn('用户已有默认 preset「' + cur + '」，没动它。想换成本插件：把 settings.yaml 的 agent-presets.default 改成 ' + PRESET_ID)
        return
      }
      lines[found] = '  default: ' + PRESET_ID
    } else {
      lines.splice(idx + 1, 0, '  default: ' + PRESET_ID)
    }
  } else {
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
    lines.push('agent-presets:', '  default: ' + PRESET_ID, '')
  }
  if (opts.dry) { log('DRY: 设默认 preset'); return }
  writeFileSync(file, lines.join('\n'), 'utf8')
  log('默认 preset = ' + PRESET_ID + '（新会话生效）')
}

function copySkill() {
  const from = path.join(TARGET, 'adapters', 'dsh', 'skills', 'whale-persona')
  const to = path.join(HOME, 'skills', 'whale-persona')
  if (!existsSync(path.join(from, 'SKILL.md'))) { warn('技能目录不存在，跳过：' + from); return }
  if (opts.dry) { log('DRY: 拷技能 -> ' + to); return }
  rmSync(to, { recursive: true, force: true })
  mkdirSync(path.dirname(to), { recursive: true })
  cpSync(from, to, { recursive: true })
  log('技能已装（之后可以直接对 AI 说「加条契约：…」）：' + to)
}

function verify() {
  if (opts.dry) return
  const r = run(['--profile', opts.profile, '--dump-config'], true)
  const text = String(r.stdout || '')
  const okUi = text.indexOf(UI_PKG) >= 0
  const okPreset = existsSync(path.join(HOME, '.agent-presets', PRESET_ID, 'agent.cordis.yml'))
  log('自检：UI 行在 profile 树里 = ' + (okUi ? 'OK' : '缺失'))
  log('自检：preset 文件 = ' + (okPreset ? 'OK' : '缺失') + '（人设行在 preset 层，dump-config 看不到它是正常的）')
}

function printNext() {
  console.log('')
  log('装完了。接下来：')
  log('  1) 重启 DSH：挂载行变更需要重启宿主进程')
  log('  2) 设置 → Agent 预设：应看到「' + PRESET_NAME + '」标着「新任务默认」')
  log('     （它就是人设的挂载点：只有绑定这份预设的会话才有你的人设）')
  log('  3) 设置 → 人设：看到此刻实际注入的三段正文 + 契约 + 长期记忆')
  log('  4) 改内容：面板里点「打开本地编辑器」，或者直接对 AI 说「加条契约：…」')
}

main()
