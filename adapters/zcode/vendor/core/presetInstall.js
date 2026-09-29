/**
 * Agent 预设（人设平面）的发现 / 创建 / 默认化 —— 唯一实现。
 *
 * 为什么有它（触发来源 2026-09-29）：插件市场（或 `dsh plugin add whale-persona`）只会把包挂进
 * **profile 平面**（`dsh.profile.bundles` + `cordis.patch.yml`），**不会**建 agent preset；
 * 而人设本体必须落在 `<DSH_HOME>/.agent-presets/<id>/agent.cordis.yml` 里那行才生效。
 * 于是市场通道装完的结果是：宿主起得来、设置面板在、**人设不注入** —— 新会话走宿主自己的默认预设，
 * 用户看到的是「装了没用」。0.17.2 之前只有 scripts/install-dsh.mjs 会建它，所以市场用户必须
 * "再手工跑一次脚本"，而市场不会替他们跑。
 *
 * 本模块把那段逻辑从安装脚本里提出来，给「安装脚本」与「设置面板（用户点一下）」共用一份：
 * 两份实现必然漂移，而这里漂移的代价是"面板说建好了、宿主不认"。
 *
 * 写入面（已登记在 .github/SECURITY.md 的写面清单里）：
 *   - `<DSH_HOME>/.agent-presets/<id>/agent.cordis.yml` 与 `preset.yml`
 *   - 可选 `<DSH_HOME>/settings.yaml`（只改 `agent-presets.default` 一行，且只在它为空/已等于本插件时改）
 * 全部幂等、支持 dry-run；**不覆盖**用户改过的显示名与预设内容。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dshHome } from './store.js'

/** 人设预设的 id（= 目录名 = roster 里那行的 id） */
export const PRESET_ID = 'whale-persona'
/** 面板与「Agent 预设」列表里显示的默认名（用户可改 preset.yml 的 name） */
export const PRESET_NAME = '自定义人设'
export const PERSONA_PKG = 'whale-persona'
/**
 * 0.15.0 之前叫这个名字（scope 带大写字母，npm 不收 —— 见 CHANGELOG v0.15.0）。
 * 注意：新名是旧名的**子串**，所以任何"包含即认为已是我们"的判断都必须先认旧名。
 */
export const LEGACY_PERSONA_PKG = '@shenA2024/whale-persona'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** id 白名单：字母数字开头，其余 . _ -，最长 64 —— 结果只可能是一个目录名（防路径穿越） */
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

function homeOf(home) {
  return path.resolve(home || dshHome())
}

/** `<DSH_HOME>/.agent-presets/<id>` */
export function presetDir(home) {
  return path.join(homeOf(home), '.agent-presets', PRESET_ID)
}

/** 决定"这个目录是不是一个 preset"的那个文件 */
export function agentFile(home) {
  return path.join(presetDir(home), 'agent.cordis.yml')
}

/**
 * npm/宿主安装根候选（宿主自带的 preset 模板在这些根下面找）。
 * 为什么不用 `npm root -g` 子进程：那是一次 shell 调用，本插件运行期零 shell 是硬纪律。
 * 桌面版那两条是 2026-09-29 补的：桌面版把 dsh 放在 `<exeDir>/resources/app.asar/dsh`，
 * 而从插件所在目录往上根本走不到它 —— 但**宿主进程内**的 fs 认 asar 路径，
 * 所以只要把这条路径猜出来就能读到 shipped preset（实测：桌面版宿主里能读到）。
 */
export function candidateRoots(home) {
  const roots = []
  if (process.env.DSH_AGENT_PRESETS_ROOT) roots.push(path.resolve(process.env.DSH_AGENT_PRESETS_ROOT))
  if (process.env.APPDATA) roots.push(path.join(process.env.APPDATA, 'npm', 'node_modules'))
  if (process.env.npm_config_prefix) roots.push(path.join(process.env.npm_config_prefix, 'node_modules'))
  const exeDir = path.dirname(process.execPath)
  roots.push(path.join(exeDir, 'node_modules'))
  roots.push(path.join(exeDir, 'resources', 'app.asar', 'dsh', 'node_modules'))
  roots.push(path.resolve(HERE, '..', 'node_modules'))
  const bin = process.env.DSH_BIN ? path.resolve(process.env.DSH_BIN) : ''
  if (bin) roots.push(path.resolve(path.dirname(bin), '..', '..', '..'))
  return [...new Set(roots.map((r) => path.resolve(r)))]
}

/** 宿主自带 preset 的根（`@deepseek-ai/dsh-agent-presets/presets`）；找不到返回空串 */
export function shippedPresetsRoot(home) {
  const subs = [
    path.join('@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-agent-presets', 'presets'),
    path.join('@deepseek-ai', 'dsh-agent-presets', 'presets'),
  ]
  for (const root of candidateRoots(home)) {
    for (const sub of subs) {
      const p = path.join(root, sub)
      try { if (statSync(p).isDirectory()) return p } catch { /* 不存在 / 读不动：换下一个候选 */ }
    }
  }
  return ''
}

/** 基座目录：用户 preset 优先，其次宿主自带；找不到返回空串 */
export function basePresetDir(home, id) {
  if (!ID_RE.test(String(id || ''))) return ''
  const user = path.join(homeOf(home), '.agent-presets', String(id))
  if (existsSync(path.join(user, 'agent.cordis.yml'))) return user
  const shippedRoot = shippedPresetsRoot(home)
  if (shippedRoot) {
    const shipped = path.join(shippedRoot, String(id))
    if (existsSync(path.join(shipped, 'agent.cordis.yml'))) return shipped
  }
  return ''
}

/** 用户当前的默认 preset id（读 `<DSH_HOME>/settings.yaml` 的 `agent-presets.default`）；没有返回空串 */
export function defaultPresetId(home) {
  const file = path.join(homeOf(home), 'settings.yaml')
  if (!existsSync(file)) return ''
  let lines = []
  try { lines = readFileSync(file, 'utf8').split(/\r?\n/) } catch { return '' }
  const idx = lines.findIndex((l) => /^agent-presets:\s*$/.test(l))
  if (idx < 0) return ''
  for (let j = idx + 1; j < lines.length; j++) {
    if (!/^\s+\S/.test(lines[j])) break
    const m = /^\s+default:\s*(\S+)\s*$/.exec(lines[j])
    if (m) return m[1]
  }
  return ''
}

/**
 * 基座选择：**跟随用户当前的默认 preset**，不替他选。
 * 为什么不是写死 standard：persona 插件跟"模式"无关，它只是替换基座里的人设行；
 * 写死标准模式会把 PTC 用户的能力面悄悄换掉（PTC 走 run_code SDK，标准走逐工具调用）。
 */
export function resolveBase({ home, base = 'auto' } = {}) {
  if (base !== 'auto' && base) return { id: String(base), why: '调用方指定' }
  const cur = defaultPresetId(home)
  if (cur && cur !== PRESET_ID) return { id: cur, why: '跟随用户当前的默认 preset' }
  if (cur === PRESET_ID) return { id: 'standard', why: '默认 preset 已是本插件（重装），回退宿主出厂默认' }
  return { id: 'standard', why: '用户没设默认 preset，用宿主出厂默认' }
}

/** 读 base preset 目录里的 preset.yml（显示名/描述）；读不到就返回空 */
function readMeta(baseDir) {
  if (!baseDir) return { name: '', description: '' }
  const file = path.join(baseDir, 'preset.yml')
  if (!existsSync(file)) return { name: '', description: '' }
  let text = ''
  try { text = readFileSync(file, 'utf8') } catch { return { name: '', description: '' } }
  const name = (/^name:\s*(.+)$/m.exec(text) || [])[1] || ''
  const description = (/^description:\s*(.+)$/m.exec(text) || [])[1] || ''
  return { name: name.trim(), description: description.trim() }
}

/**
 * 把基座里的官方人设行换成我们这行。
 * 判据是 `- id: persona` 这个**行首**（基座里官方那段的 id 就叫 persona），
 * 到下一个 `- ` 行之前整段替换 —— 官方那行可能带 config/prepend/append 子键，只换 name 会留下它的 config。
 */
export function swapPersonaRowIn(file) {
  let text = ''
  try { text = readFileSync(file, 'utf8') } catch { return { swapped: false, text: '' } }
  const lines = text.split(/\r?\n/)
  const out = []
  let swapped = false
  for (let i = 0; i < lines.length; i++) {
    if (!swapped && /^- id: persona\s*$/.test(lines[i])) {
      let j = i + 1
      while (j < lines.length && !/^- /.test(lines[j])) j++
      out.push('- id: ' + PRESET_ID)
      out.push("  name: '" + PERSONA_PKG + "'")
      if (j < lines.length && lines[j].trim() !== '') out.push('')
      i = j - 1
      swapped = true
      continue
    }
    out.push(lines[i])
  }
  if (swapped) writeFileSync(file, out.join('\n'), 'utf8')
  return { swapped, text: out.join('\n') }
}

function metaText(baseId) {
  return 'name: ' + PRESET_NAME + '\n'
    + 'description: 基于 ' + baseId + ' 模式 + whale-persona 人设引擎（显示名改这一行）\n'
    + 'order: 9\n'
}

/** 重装时只补元数据：用户改过的显示名/描述不动 */
export function refreshPresetMeta(dir) {
  const file = path.join(dir, 'preset.yml')
  if (!existsSync(file)) { writeFileSync(file, metaText('standard'), 'utf8'); return }
  let cur = ''
  try { cur = readFileSync(file, 'utf8') } catch { cur = '' }
  const hasName = /^name:\s*\S/m.test(cur)
  const hasDesc = /^description:\s*\S/m.test(cur)
  if (hasName && hasDesc) return
  const lines = []
  lines.push(hasName ? /^name:.*$/m.exec(cur)[0] : 'name: ' + PRESET_NAME)
  if (!hasDesc) lines.push('description: whale-persona 人设引擎（显示名改这一行）')
  lines.push('order: 9')
  writeFileSync(file, lines.join('\n') + '\n', 'utf8')
}

/** preset 此刻的状态（面板与安装脚本都读这一份） */
export function presetState(home) {
  const dir = presetDir(home)
  const file = agentFile(home)
  const exists = existsSync(file)
  let text = ''
  if (exists) { try { text = readFileSync(file, 'utf8') } catch { text = '' } }
  const legacy = !!text && text.includes(LEGACY_PERSONA_PKG)
  const hasPersonaRow = exists && (legacy || /name:\s*'whale-persona'/.test(text))
  const meta = readMeta(dir)
  const cur = defaultPresetId(home)
  const base = resolveBase({ home })
  return {
    id: PRESET_ID,
    dir,
    agentFile: file,
    installed: exists,
    healthy: exists && hasPersonaRow,
    hasPersonaRow,
    legacy,
    displayName: meta.name || PRESET_NAME,
    description: meta.description,
    defaultPresetId: cur,
    isDefault: cur === PRESET_ID,
    otherDefault: !!cur && cur !== PRESET_ID,
    baseId: base.id,
    baseWhy: base.why,
    baseAvailable: !!basePresetDir(home, base.id),
    shippedRoot: shippedPresetsRoot(home),
  }
}

function manualHints(home, base) {
  const dir = presetDir(home)
  return [
    '找不到基座 preset「' + base.id + '」，preset 没建。手工做法：',
    '  1) 把 <宿主 preset 目录>/' + base.id + ' 复制到 ' + dir,
    "  2) 把里面 - id: persona / name: '@deepseek-ai/dsh-persona' 那段换成",
    '     - id: ' + PRESET_ID,
    "       name: '" + PERSONA_PKG + "'",
  ]
}

/**
 * 建/修 preset（幂等）。
 * @returns {{ok: boolean, action: 'kept'|'created'|'dry'|'no-base', dir: string,
 *            baseId: string, baseWhy: string, swapped: boolean, messages: string[]}}
 */
export function installPreset({ home, base = 'auto', dryRun = false } = {}) {
  const dir = presetDir(home)
  const file = agentFile(home)
  const messages = []
  const exists = existsSync(file)
  let cur = ''
  if (exists) { try { cur = readFileSync(file, 'utf8') } catch { cur = '' } }
  const hasLegacy = !!cur && cur.includes(LEGACY_PERSONA_PKG)
  // 旧名是新名的子串：单看"含 whale-persona"会把旧预设误判成"已经是我们的"，于是原地不动 →
  // 预设指向一个已经不装的模块。所以先做就地改名迁移，再判归属。
  if (hasLegacy) {
    if (!dryRun) writeFileSync(file, cur.split(LEGACY_PERSONA_PKG).join(PERSONA_PKG), 'utf8')
    // dry-run 也要报这句：安装脚本的自检（tests/install-contract.mjs I6）就是拿它当判据的，
    // 只在真写盘时报会让"预演"和"实跑"看到的东西不一样。
    messages.push((dryRun ? 'DRY: ' : '') + 'preset 里的旧包名就地换成 ' + PERSONA_PKG + '：' + file)
  }
  const ours = exists && (hasLegacy || /name:\s*'whale-persona'/.test(cur))
  if (ours) {
    if (!dryRun) refreshPresetMeta(dir)
    messages.push('preset 已存在，保留它的基座与内容（只补显示名/描述）：' + dir)
    return { ok: true, action: 'kept', dir, baseId: '', baseWhy: '', swapped: false, messages }
  }
  const b = resolveBase({ home, base })
  const src = basePresetDir(home, b.id)
  if (!src) {
    return { ok: false, action: 'no-base', dir, baseId: b.id, baseWhy: b.why, swapped: false, messages: manualHints(home, b) }
  }
  messages.push('基座 preset = ' + b.id + '（' + b.why + '）<- ' + src)
  if (dryRun) {
    messages.push('DRY: 会建 preset -> ' + dir)
    return { ok: true, action: 'dry', dir, baseId: b.id, baseWhy: b.why, swapped: false, messages }
  }
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(path.dirname(dir), { recursive: true })
  cpSync(src, dir, { recursive: true })
  const { swapped } = swapPersonaRowIn(file)
  if (!swapped) {
    messages.push('警告：基座里没有 - id: persona 行，人设行没替换；请手工加：')
    messages.push('  - id: ' + PRESET_ID)
    messages.push("    name: '" + PERSONA_PKG + "'")
  }
  writeFileSync(path.join(dir, 'preset.yml'), metaText(b.id), 'utf8')
  messages.push('preset 已就绪：' + dir + '   显示名「' + PRESET_NAME + '」')
  return { ok: true, action: 'created', dir, baseId: b.id, baseWhy: b.why, swapped, messages }
}

/**
 * 把本插件设成**新会话默认** preset（写 settings.yaml 的 `agent-presets.default`）。
 * 只在①没有 default 或②default 已经是本插件时写；用户另有默认则**不动**（那是他的选择）。
 */
export function setDefaultPreset({ home, dryRun = false } = {}) {
  const file = path.join(homeOf(home), 'settings.yaml')
  const cur = defaultPresetId(home)
  if (cur === PRESET_ID) return { ok: true, changed: false, reason: '已经是默认 preset', file }
  if (cur) return { ok: false, changed: false, reason: '用户已有默认 preset「' + cur + '」，没动它', file }
  let lines = []
  if (existsSync(file)) { try { lines = readFileSync(file, 'utf8').split(/\r?\n/) } catch { lines = [] } }
  const idx = lines.findIndex((l) => /^agent-presets:\s*$/.test(l))
  if (idx < 0) {
    lines.push('agent-presets:', '  default: ' + PRESET_ID, '')
  } else {
    let found = -1
    for (let j = idx + 1; j < lines.length; j++) {
      if (!/^\s+\S/.test(lines[j])) break
      if (/^\s+default:\s*\S*\s*$/.test(lines[j])) { found = j; break }
    }
    if (found >= 0) lines[found] = '  default: ' + PRESET_ID
    else lines.splice(idx + 1, 0, '  default: ' + PRESET_ID)
  }
  if (dryRun) return { ok: true, changed: true, reason: 'DRY: 会把默认 preset 写成 ' + PRESET_ID, file }
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, lines.join('\n'), 'utf8')
  return { ok: true, changed: true, reason: '默认 preset = ' + PRESET_ID + '（新会话生效）', file }
}
