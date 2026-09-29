#!/usr/bin/env node
/**
 * whale-persona —— DSH 一条命令安装器
 *
 * 为什么需要它（2026-09-18 在干净 DSH_HOME 上实测踩出来的三条）：
 *   ① dsh plugin add github:user/repo 在这个 monorepo 布局下装不上：profile 的 pnpm workspace 拒收裸 add、
 *      pnpm 把 github: 展开成 ssh、pnpm 不支持子目录 git 依赖、仓库根原本没有 package.json；
 *   ② 人设行必须挂 agent preset 平面，挂 profile 平面会让整个插件树加载失败（prompt section already registered）；
 *   ③ 装完不设默认 preset，用户看到的还是官方默认人设。
 *   ④ 0.11.2：宿主会把声明 dsh.bundle 的依赖自动挂进 profile 的 dsh.profile.bundles，而那个 bundle
 *      的 patch 里已经插了设置面板行；旧脚本只看 profile 自己的 patch 文件，于是又插一条同 id 行 ——
 *      loader 的 entry id 全局唯一，重复即硬错，整个插件树起不来。现在装与重装都先算清这条行的归属。
 *      纯判定拆到 scripts/ui-row.mjs：安装脚本不再靠"比字符串"判断自己是不是入口（那样在 pnpm 的
 *      junction 路径下会判错，main() 静默不跑、退出码还是 0）。
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
 *
 * 安全纪律（2026-09-18 审查修复，别再退回去）：
 *   · **不许出现 shell:true / 命令字符串拼接**。Windows 上 dsh 是 .cmd 垫片，Node 18.20+ 要求 .cmd
 *     必须走 shell——本脚本的解法是自己定位 @deepseek-ai/dsh/lib/bin.js 交给 process.execPath 跑，
 *     全程数组传参、shell:false。找得到就用，找不到就报错退出（绝不用 shell 兜底）。
 *   · --profile / --base 走白名单校验（字母数字与 . _ -），路径参数一律 path.resolve，
 *     杜绝「畸形 id = 路径穿越 / 命令注入」。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import { createRequire } from 'node:module'
import { applyUiRow } from './ui-row.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LEGACY_PERSONA_PKG, PERSONA_PKG, PRESET_ID, PRESET_NAME,
  installPreset, presetState,
  setDefaultPreset as writeDefaultPreset,
} from '../core/presetInstall.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SOURCE = path.resolve(HERE, '..')
// 0.15.0 之前叫这两个名字（scope 带大写字母，npm 不收 —— 见 CHANGELOG v0.15.0）。
// 注意：新名是旧名的**子串**，所以任何"包含即认为已装"的判断都必须先认旧名再认新名。
// PERSONA_PKG / LEGACY_PERSONA_PKG / PRESET_ID / PRESET_NAME 自 0.17.3 起从 core/presetInstall.js 来：
// preset 的发现与生成归它（设置面板走同一份），常量跟着它走，别在这里再写一份。
const UI_PKG = 'whale-persona-ui'
// 面板包的旧名只是脚本自己的迁移目标，留在本地。
const LEGACY_UI_PKG = '@shenA2024/whale-persona-ui'
const SELF = 'whale-persona:'
/** profile / preset id 白名单：字母数字开头，其余 . _ -，最长 64 —— 结果只可能是一个目录名 */
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

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

if (!ID_RE.test(opts.profile)) { console.error(SELF + ' 非法 --profile（只允许字母数字与 . _ -，最长 64）：' + JSON.stringify(opts.profile)); process.exit(2) }
if (opts.base !== 'auto' && !ID_RE.test(opts.base)) { console.error(SELF + ' 非法 --base：' + JSON.stringify(opts.base)); process.exit(2) }

const HOME = path.resolve(opts.home || process.env.DSH_HOME || path.join(os.homedir(), '.dsh'))
const PROFILE_DIR = path.join(HOME, 'profiles', opts.profile)
const TARGET = opts.link ? opts.source : path.join(HOME, 'plugins', PRESET_ID)
// data/ 是 .gitignore 掉的开发脚手架（演示 home、宣传截图、评测脚本），用户 clone 里没有；
// 2026-09-19 实测：它里面的 junction 让 cpSync 抛 EPERM，整个安装中断在复制那一步 —— 一并跳过。
const SKIP_DIRS = new Set(['.git', 'node_modules', 'out', 'dist', 'build', '.tmp', 'research', '.github', '.inbox', 'data'])

const log = (m) => console.log(SELF + ' ' + m)
const warn = (m) => console.warn(SELF + ' ! ' + m)
const fail = (m) => { console.error(SELF + ' ' + m); process.exitCode = 1 }

/**
 * 可能的 npm 安装根（dsh 与 preset 模板都在这下面找）。
 * 为什么不用 `npm root -g` 子进程：那是一次 shell 调用（Windows 下 npm 也是 .cmd），
 * 本脚本运行期零 shell 是硬纪律；这几个候选覆盖官方安装器 / nvm-windows / 便携 node / 本地开发。
 */
function candidateRoots() {
  const roots = []
  if (process.env.DSH_AGENT_PRESETS_ROOT) roots.push(path.resolve(process.env.DSH_AGENT_PRESETS_ROOT))
  if (process.env.APPDATA) roots.push(path.join(process.env.APPDATA, 'npm', 'node_modules'))
  if (process.env.npm_config_prefix) roots.push(path.join(process.env.npm_config_prefix, 'node_modules'))
  roots.push(path.join(path.dirname(process.execPath), 'node_modules'))
  roots.push(path.resolve(HERE, '..', 'node_modules'))
  const bin = process.env.DSH_BIN ? path.resolve(process.env.DSH_BIN) : ''
  if (bin) roots.push(path.resolve(path.dirname(bin), '..', '..', '..')) // <root>/@deepseek-ai/dsh/lib/bin.js
  return [...new Set(roots.map((r) => path.resolve(r)))]
}

/** dsh 的 JS 入口（bin.js）；找不到返回空串 —— 调用方必须报错退出，不许用 shell 兜底 */
function dshEntry() {
  const env = String(process.env.DSH_BIN || '').trim()
  if (env) {
    const p = path.resolve(env)
    if (existsSync(p)) return p
    warn('DSH_BIN 指向的文件不存在：' + p)
  }
  for (const root of candidateRoots()) {
    const p = path.join(root, '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    if (existsSync(p)) return p
  }
  return ''
}
const DSH_BIN_JS = dshEntry()

/** 跑 dsh 子命令：数组传参 + shell:false（见文件头「安全纪律」） */
function run(args, quiet) {
  const env = Object.assign({}, process.env)
  env.DSH_HOME = HOME
  const stdio = quiet ? 'pipe' : 'inherit'
  if (!DSH_BIN_JS) {
    return { status: 1, stdout: '', stderr: '找不到 dsh 入口（@deepseek-ai/dsh/lib/bin.js）。设环境变量 DSH_BIN 指向它后重试。' }
  }
  return spawnSync(process.execPath, [DSH_BIN_JS].concat(args), { stdio, env, encoding: 'utf8', shell: false })
}

function main() {
  if (opts.help) return printHelp()
  log('DSH_HOME   = ' + HOME)
  log('profile    = ' + opts.profile)
  log('source     = ' + opts.source)
  log('dsh 入口   = ' + (DSH_BIN_JS || '（找不到，下面会报错）'))
  log('install to = ' + TARGET + (opts.link ? '   (link: 直接用当前仓库)' : '   (copy)'))
  if (!existsSync(path.join(opts.source, 'adapters', 'dsh', 'index.js'))) {
    return fail('这个目录不像 whale-persona 仓库：' + opts.source)
  }
  if (!DSH_BIN_JS) {
    warn('没找到 dsh 的 bin.js —— 候选根：')
    for (const r of candidateRoots()) warn('  ' + r)
    warn('装了 dsh 的话，把它的 bin.js 路径写进环境变量 DSH_BIN 再跑一次。')
    return
  }
  if (!opts.link && path.resolve(TARGET).toLowerCase().indexOf(path.resolve(opts.source).toLowerCase() + path.sep) === 0) {
    return fail('安装目标在源仓库内部（' + TARGET + '）：复制等于"自己复制自己"。把 DSH_HOME 放到仓库外，或加 --link 直接用当前仓库（开发用）。')
  }
  ensureProfile()
  if (!opts.dry) copyTree()
  dropLegacy()
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

/**
 * 物化 profile（干净 DSH_HOME 上实测踩出来的两条）：
 *   ① profile 名与宿主**自带模板**同名（web / headless …）时，绝对不能带 --from-default-profile——
 *      宿主明确拒绝：profile "web" is shipped and cannot be a custom profile target: omit --from-default-profile to use it；
 *      直接 --profile web --dump-config 就会把 <home>/profiles/web 物化出来。
 *   ② 自定义名字才需要从 web 模板派生。
 */
function ensureProfile() {
  if (existsSync(path.join(PROFILE_DIR, 'package.json'))) { log('profile 已存在：' + PROFILE_DIR); return }
  log('profile 不存在，交给宿主物化：' + PROFILE_DIR)
  if (opts.dry) { log('DRY: 物化 profile'); return }
  let r = run(['--profile', opts.profile, '--dump-config'], true)
  if (r.status === 0 && existsSync(path.join(PROFILE_DIR, 'package.json'))) {
    log('profile 已用宿主自带模板物化（同名自带模板不需要 --from-default-profile）')
    return
  }
  r = run(['--profile', opts.profile, '--from-default-profile', 'web', '--dump-config'], true)
  if (r.status !== 0 || !existsSync(path.join(PROFILE_DIR, 'package.json'))) {
    fail('创建 profile 失败：' + String(r.stderr || '').trim().split('\n').slice(0, 2).join(' | '))
  }
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

/** 读我们自己那份 package.json 的 dsh.bundle.patch（没有/坏 JSON 返回空串）。
 *  改判据的触发来源见 installPackage 里的注释：不能拿宿主输出的整段文本当"我们没声明"的证据。 */
function ownBundlePatch(dir) {
  try {
    const m = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
    return String(((m.dsh || {}).bundle || {}).patch || '')
  } catch {
    return ''
  }
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
  // 判据必须落在**我们自己的 manifest** 上：早先版本拿 plugin add 的整段输出里搜
  // 'declares no dsh.bundle' 就下结论，而那句话可能来自 profile 里**别的包**
  // （2026-09-22 实测：干净 home 里本包声明齐全，仍被误报"没有 dsh.bundle 声明"）。
  const patchRel = ownBundlePatch(dir)
  if (patchRel && !existsSync(path.join(dir, patchRel))) {
    warn('包内声明了 dsh.bundle.patch（' + patchRel + '）但文件不存在——包里多半漏打了它')
  } else if (out.indexOf('declares no dsh.bundle') >= 0) {
    log('（宿主输出里有「declares no dsh.bundle」的警告，但本包声明齐全，与你无关）')
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

/**
 * preset 的发现与生成自 0.17.3 起全在 core/presetInstall.js —— 设置面板的「建人设预设」
 * 走的就是同一份实现，两边各写一份必然漂移，而漂移的代价是"面板说建好了、宿主不认"。
 * 这里只剩「跑一遍 + 把结果翻成人话」：日志文案是安装脚本的对外接口（tests/install-contract.mjs 钉着）。
 */
function writePreset() {
  const r = installPreset({ home: HOME, base: opts.base, dryRun: opts.dry })
  for (const m of r.messages) (r.ok ? log : warn)(m)
}

// ── 设置面板行的归属判定：纯逻辑在 ./ui-row.mjs，这里只做「读 profile + 落盘」────
// 触发来源：2026-09-19 干净 DSH_HOME 实测 —— dsh plugin add 会把声明 dsh.bundle 的依赖自动追加
// 进 profile 的 dsh.profile.bundles，而那个 bundle 的 patch 里已经插了 whale-persona-ui；旧脚本只看
// profile 自己的 cordis.patch.yml，于是又插一条同 id 行 —— loader 的 entry id 全局唯一，重复即硬错。
// 判据：同一 id 只能有一个来源；bundle 已经挂了，profile 层就一条都不该留。

/** 读 JSON；文件不存在或坏掉都返回 null（不抛） */
function readJsonSafe(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
}

/** 包名 → package.json 路径：profile 自己的 node_modules 优先，其次 profiles 共享层，最后交给 node 解析 */
function manifestPathOf(pkgName) {
  const segments = String(pkgName).split('/')
  const direct = [
    path.join(PROFILE_DIR, 'node_modules', ...segments, 'package.json'),
    path.join(HOME, 'profiles', 'node_modules', ...segments, 'package.json'),
  ]
  for (const candidate of direct) if (existsSync(candidate)) return candidate
  try {
    return createRequire(path.join(PROFILE_DIR, 'package.json')).resolve(String(pkgName) + '/package.json')
  } catch { return '' }
}

/** 已挂进 profile 的 bundle 里，有没有谁已经插了同一条设置面板行；有则返回那个包名，没有返回空串 */
function bundleOwningUiRow() {
  const manifest = readJsonSafe(path.join(PROFILE_DIR, 'package.json'))
  const bundles = (manifest && manifest.dsh && manifest.dsh.profile && manifest.dsh.profile.bundles) || []
  for (const rawName of bundles) {
    const file = manifestPathOf(rawName)
    if (!file) continue
    const pkg = readJsonSafe(file)
    const rel = pkg && pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch
    if (typeof rel !== 'string' || rel === '') continue
    const patchFile = path.resolve(path.dirname(file), rel)
    if (existsSync(patchFile) && readFileSync(patchFile, 'utf8').indexOf(UI_PKG) >= 0) return String(rawName)
  }
  return ''
}

/**
 * 0.15.0 改名迁移：把旧包名的残留从 profile 上摘干净。
 * 为什么必须做：旧依赖还在 → 旧包还挂在 `dsh.profile.bundles` 上 → 与新的同名插件同时注册人设段，
 * 宿主直接报「prompt section 已注册」起不来。宁可多删一次，也不要留两条同名挂载行。
 * 只删我们自己那两个包名，用户自己写的别的依赖一个不动。
 */
function dropLegacy() {
  const touched = []
  const pkgFile = path.join(PROFILE_DIR, 'package.json')
  const manifest = readJsonSafe(pkgFile)
  if (manifest) {
    let changed = false
    for (const k of [LEGACY_PERSONA_PKG, LEGACY_UI_PKG]) {
      if (manifest.dependencies && manifest.dependencies[k] !== undefined) { delete manifest.dependencies[k]; changed = true }
    }
    const bundles = manifest.dsh && manifest.dsh.profile && manifest.dsh.profile.bundles
    if (Array.isArray(bundles)) {
      const kept = bundles.filter((b) => b !== LEGACY_PERSONA_PKG)
      if (kept.length !== bundles.length) { manifest.dsh.profile.bundles = kept; changed = true }
    }
    if (changed) {
      if (!opts.dry) writeFileSync(pkgFile, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
      touched.push(pkgFile)
    }
  }
  for (const k of [LEGACY_PERSONA_PKG, LEGACY_UI_PKG]) {
    const p = path.join(PROFILE_DIR, 'node_modules', ...k.split('/'))
    if (existsSync(p)) { if (!opts.dry) rmSync(p, { recursive: true, force: true }); touched.push(p) }
  }
  if (touched.length) log((opts.dry ? 'DRY: ' : '') + '清掉旧包名（' + LEGACY_PERSONA_PKG + '）残留 ' + touched.length + ' 处：' + touched.join(' | '))
  else log('没有旧包名残留（0.15.0 改名迁移无需动作）')
}

function patchProfileRow() {
  const file = path.join(PROFILE_DIR, 'cordis.patch.yml')
  const raw = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const result = applyUiRow({ profilePatch: raw, bundleOwner: bundleOwningUiRow() })
  if (result.action === 'none') { log(result.reason); return }
  if (opts.dry) { log('DRY: ' + result.action + ' profile 行 -> ' + file + '（' + result.reason + '）'); return }
  writeFileSync(file, result.text, 'utf8')
  log(result.reason + '：' + file)
}

/** 设「新会话默认」preset —— 同样只有 core/presetInstall.js 一份实现（用户另有默认就不动）。 */
function setDefaultPreset() {
  const r = writeDefaultPreset({ home: HOME, dryRun: opts.dry })
  if (!r.ok) {
    warn(r.reason + '。想换成本插件：把 settings.yaml 的 agent-presets.default 改成 ' + PRESET_ID)
    return
  }
  log(r.reason)
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
  const st = presetState(HOME)
  log('自检：UI 行在 profile 树里 = ' + (okUi ? 'OK' : '缺失'))
  log('自检：preset 文件 = ' + (st.installed ? 'OK' : '缺失') + '（人设行在 preset 层，dump-config 看不到它是正常的）')
  log('自检：preset 里的人设行 = ' + (st.hasPersonaRow ? 'OK' : '缺失（或指向别的包）'))
  const inbox = path.join(HOME, configDirName(), 'memory-inbox.jsonl')
  if (existsSync(inbox)) {
    log('提示：检测到记忆收件箱 ' + inbox.replace(/\\/g, '/') + ' —— 0.8.0 起「未确认候选」不注入，用 node scripts/memory.mjs status 看待确认条目。')
  }
}

/** 配置目录名（与 core/store.js 的定位链一致：旧布局 whale-suite 里有 config.json 就沿用） */
function configDirName() {
  return existsSync(path.join(HOME, 'whale-suite', 'config.json')) ? 'whale-suite' : 'whale-persona'
}

function printNext() {
  console.log('')
  log('装完了。接下来：')
  log('  1) 重启 DSH：挂载行变更需要重启宿主进程')
  log('  2) 设置 → Agent 预设：应看到「' + PRESET_NAME + '」标着「新任务默认」')
  log('     （它就是人设的挂载点：只有绑定这份预设的会话才有你的人设）')
  log('  3) 设置 → 人设：左边直接改（自称/称呼/立场/正文/工作契约/长期记忆），右边实时看"实际注入的三段"')
  log('  4) 想手改就手改：面板里改完点保存即可（与本地编辑器同一套读写纪律）；也可以对 AI 说「加条契约：…」')
  log('  5) 长期记忆候选要**你自己确认**才生效：node scripts/memory.mjs status | confirm <序号>（AI 只能写「候选」）')
}

main()
