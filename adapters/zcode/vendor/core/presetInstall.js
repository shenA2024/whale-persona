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

/**
 * 宿主用哪套 preset 机制（2026-09-29 / 0.17.5 新增）。
 *
 * 触发来源：0.17.3 的面板只认 `<DSH_HOME>/.agent-presets`，于是在桌面版上**量错了平面** ——
 * 显示的数字、以及「建人设预设」「设为新任务默认」两个按钮，对桌面版都不适用。
 *
 * 两套机制（都是真机读出来的）：
 *  - `agent-presets`：传统 —— 预设是 `<DSH_HOME>/.agent-presets/<id>/agent.cordis.yml`（web profile / npm 版走这条）
 *  - `profile`      ：桌面版 0.1.7-rc.1+ —— 预设是**profile 组合里的一行**：`cordis.patch.yml` 的
 *                     `agent-preset-registry` 段（`default` / `selectedDefault`）＋ 一个 `- insert:` 块里
 *                     `id: preset-*` / `name: "@deepseek-ai/dsh-agent-preset"` 的项（`config.plugins` 里挂人设行）。
 *                     （asar 全量 js 里没有 `.agent-presets` 字样 —— 2026-09-25 实测）
 *
 * 判据（不猜，都有实测依据）：
 *  ① profile 名：宿主进程 argv 里带 `<DSH_HOME>/profiles/<name>`
 *     （2026-09-29 实测桌面版命令行：`… dsh-desktop-host/lib/index.js … <DSH_HOME>\profiles\desktop …`）；
 *     退回环境变量 `DSH_PROFILE` / `DSH_PROFILE_NAME`。
 *  ② 该 profile 的 `cordis.patch.yml` 里有没有 `- id: agent-preset-registry` 段：有＝profile 平面。
 *     对照实测：desktop 有、web 没有。
 */
export function currentProfileName(home) {
  const root = path.join(homeOf(home), 'profiles')
  const rl = path.resolve(root).toLowerCase()
  for (const a of (process.argv || [])) {
    const s = String(a || '')
    if (!s || s.indexOf('profiles') < 0) continue
    let r = ''
    try { r = path.resolve(s).toLowerCase() } catch { continue }
    if (r !== rl && !r.startsWith(rl + path.sep)) continue
    const name = r.slice(rl.length + 1).split(path.sep)[0] || ''
    if (ID_RE.test(name)) return name
  }
  for (const k of ['DSH_PROFILE', 'DSH_PROFILE_NAME']) {
    const v = String(process.env[k] || '').trim()
    if (ID_RE.test(v)) return v
  }
  return ''
}

export function detectPresetPlane(home) {
  const h = homeOf(home)
  const profileName = currentProfileName(home)
  const profileDir = profileName ? path.join(h, 'profiles', profileName) : ''
  const patchFile = profileDir ? path.join(profileDir, 'cordis.patch.yml') : ''
  let registryPresent = false
  if (patchFile && existsSync(patchFile)) {
    try { registryPresent = parsePatchPresets(readFileSync(patchFile, 'utf8')).registryPresent } catch { registryPresent = false }
  }
  const plane = registryPresent ? 'profile' : 'agent-presets'
  const why = registryPresent
    ? 'profile「' + profileName + '」的 cordis.patch.yml 挂了 agent-preset-registry（桌面版机制：预设＝组合里的一行）'
    : (profileName
      ? 'profile「' + profileName + '」没有 agent-preset-registry 段（走 <DSH_HOME>/.agent-presets 目录）'
      : '宿主 argv 里没有 profile 路径，按传统 .agent-presets 平面处理')
  return { plane, profileName, profileDir, patchFile, registryPresent, why }
}

/**
 * 解析 profile 的 cordis.patch.yml —— 只认我们要的两件事：registry 段、insert 里的 preset-* 项。
 * 为什么不上 YAML 库：本插件零依赖是硬纪律（与 candidateRoots 里"运行期零 shell"同一条）。
 */
export function parsePatchPresets(text) {
  const lines = String(text || '').split(/\r?\n/)
  let registryPresent = false
  let registryLine = -1
  let selectedDefault = ''
  let defaultId = ''
  const presets = []
  for (let i = 0; i < lines.length; i++) {
    if (/^- id:\s*agent-preset-registry\s*$/.test(lines[i])) {
      registryPresent = true
      registryLine = i
      for (let j = i + 1; j < lines.length && !/^- /.test(lines[j]); j++) {
        let m = /^\s+selectedDefault:\s*(\S*)\s*$/.exec(lines[j])
        if (m) selectedDefault = m[1]
        m = /^\s+default:\s*(\S*)\s*$/.exec(lines[j])
        if (m) defaultId = m[1]
      }
    }
    if (/^-\s+insert:\s*$/.test(lines[i])) {
      let j = i + 1
      while (j < lines.length && !/^- /.test(lines[j])) {
        const mm = /^\s+- id:\s*(preset-[A-Za-z0-9._-]+)\s*$/.exec(lines[j])
        if (!mm) { j++; continue }
        // 项的结束：遇到顶层行、或**同层/更外层**的下一个 - id:。
        // 不能一见到缩进更深的 - id: 就停 —— 那正是 config.plugins 里的插件行，人设行就挂在那儿
        // （0.17.5 首跑就栽在这：fixture 里的人设行被切掉，于是"已就绪"读成"缺"）。
        const baseIndent = (/^(\s*)- id:/.exec(lines[j]) || ['', ''])[1]
        let end = j + 1
        while (end < lines.length) {
          if (/^- /.test(lines[end])) break
          const m2 = /^(\s*)- id:/.exec(lines[end])
          if (m2 && m2[1].length <= baseIndent.length) break
          end++
        }
        presets.push(parsePresetItem(lines.slice(j, end), mm[1]))
        j = end
      }
    }
  }
  return { registryPresent, registryLine, selectedDefault, defaultId, presets }
}

/** insert 块里的一项：config.id / config.name / config.description / plugins 里有没有人设行 */
function parsePresetItem(block, insertId) {
  let inPlugins = false
  let id = ''
  let name = ''
  let description = ''
  let hasPersonaRow = false
  for (const raw of block) {
    const l = String(raw).replace(/\s+$/, '')
    if (/^\s+plugins:\s*$/.test(l)) { inPlugins = true; continue }
    if (inPlugins) {
      if (/^\s+-\s*id:\s*whale-persona\s*$/.test(l)) hasPersonaRow = true
      if (/name:\s*['"]?(?:@shenA2024\/)?whale-persona['"]?\s*$/.test(l)) hasPersonaRow = true
      continue
    }
    let m = /^\s+id:\s*(\S*)\s*$/.exec(l)
    if (m && !id) id = m[1]
    // loader 行里的 name 是包名（可能带引号），config 里的 name 才是显示名 —— 按 @ 分。
    // 必须先剥引号再判 @：`name: "@deepseek-ai/dsh-agent-preset"` 的首字符是引号，
    // 不剥就会把包名当成预设显示名端给面板（0.17.5 首跑实测）。
    m = /^\s+name:\s*(\S.*?)\s*$/.exec(l)
    if (m && !name) {
      const v = m[1].replace(/^['"]|['"]$/g, '')
      if (v.charAt(0) !== '@') name = v
    }
    m = /^\s+description:\s*(.+?)\s*$/.exec(l)
    if (m && !description) description = m[1]
  }
  return { insertId, id, name, description, hasPersonaRow }
}

/** profile 平面（桌面版）下的状态读数 —— 字段与 .agent-presets 平面同形状，面板不必分两套渲染 */
function profilePlaneState(home, plane) {
  const file = plane.patchFile
  let text = ''
  if (file && existsSync(file)) { try { text = readFileSync(file, 'utf8') } catch { text = '' } }
  const p = parsePatchPresets(text)
  const mine = p.presets.find((x) => x.hasPersonaRow) || null
  const cur = p.selectedDefault
  const planeId = mine ? mine.id : ''
  return {
    id: PRESET_ID,
    plane: 'profile',
    planeWhy: plane.why,
    profileName: plane.profileName,
    profileDir: plane.profileDir,
    patchFile: file,
    dir: file,
    agentFile: file,
    installed: !!mine,
    healthy: !!mine,
    hasPersonaRow: !!mine,
    legacy: false,
    displayName: (mine && mine.name) || PRESET_NAME,
    description: (mine && mine.description) || '',
    presetIdInPlane: planeId,
    defaultPresetId: cur,
    isDefault: !!planeId && cur === planeId,
    otherDefault: !!cur && cur !== planeId,
    baseId: p.defaultId || 'standard',
    baseWhy: 'profile 机制下基座由宿主的 agent-preset-registry 决定',
    baseAvailable: true,
    shippedRoot: '',
  }
}

/** preset 此刻的状态（面板与安装脚本都读这一份） */
export function presetState(home) {
  const plane = detectPresetPlane(home)
  if (plane.plane === 'profile') return profilePlaneState(home, plane)
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
    plane: 'agent-presets',
    planeWhy: plane.why,
    profileName: plane.profileName,
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

/** profile 平面写不进去时的兜底：把照抄能用的步骤原样端出来 */
function profileManualHints(file) {
  return [
    '桌面版不认 .agent-presets 目录，预设写在 profile 组合里。手工做法：',
    '  1) 打开 ' + file,
    '  2) 末尾追加一个 insert 块（裸行会报 patch: entry not found，必须走 insert）：',
    '     - insert:',
    '         - id: preset-' + PRESET_ID,
    '           name: "@deepseek-ai/dsh-agent-preset"',
    '           config:',
    '             id: ' + PRESET_ID,
    '             name: ' + PRESET_NAME,
    '             description: 基于 standard 模式 + whale-persona 人设引擎',
    '             order: 9',
    '             plugins:',
    '               - id: ' + PRESET_ID,
    "                 name: '" + PERSONA_PKG + "'",
    '     （plugins 里还要把基座组合的其余插件行一并搬进来 —— 只挂人设行＝这个预设下没有工具）',
    '  3) 在 agent-preset-registry 段把 selectedDefault 写成这个 preset 的 config.id',
  ]
}

/** 把基座 preset 的文本换成本插件的：`- id: persona` 那两行换成人设行（纯文本版，不写盘） */
function swapPersonaRowsInText(text) {
  const re = /^(\s*)- id: persona\s*\r?\n(\s*)name:\s*['"]?@deepseek-ai\/dsh-persona['"]?\s*$/m
  if (!re.test(text)) return { swapped: false, text }
  return {
    swapped: true,
    text: text.replace(re, (_m, i1, i2) => i1 + '- id: ' + PRESET_ID + '\n' + i2 + "name: '" + PERSONA_PKG + "'"),
  }
}

/**
 * 造出要追加进 profile 组合的那个 `- insert:` 块。
 *
 * 内容是**从基座 preset 克隆**的，不是手写模板：桌面版 presets 里那一串插件行就是"这个预设下加载什么"，
 * 只挂人设行＝那个预设下没有工具（连 shell、文件都点不动），所以必须连工具面一起搬
 * —— 2026-09-25 人工搬的那份也是这么来的。
 * 缩进按目标位置算：`- insert:`(0) → `- id: preset-*`(4) → `config:`(6) → `plugins:`(8) → 插件行(10)。
 */
function buildProfileInsertBlock(home) {
  const b = resolveBase({ home })
  const src = basePresetDir(home, b.id)
  const baseFile = src ? path.join(src, 'agent.cordis.yml') : ''
  if (!baseFile || !existsSync(baseFile)) {
    return {
      ok: false,
      baseId: b.id,
      baseWhy: b.why,
      messages: ['找不到基座 preset「' + b.id + '」的 agent.cordis.yml（' + (baseFile || '无候选根）') + '），没动你的 profile 组合。', ...profileManualHints('')],
    }
  }
  let baseText = ''
  try { baseText = readFileSync(baseFile, 'utf8') } catch { baseText = '' }
  const sw = swapPersonaRowsInText(baseText)
  if (!sw.swapped) {
    return {
      ok: false,
      baseId: b.id,
      baseWhy: b.why,
      messages: ['基座 preset「' + b.id + '」里没有 `- id: persona` 行，不敢猜该怎么挂人设，没动你的 profile 组合。', ...profileManualHints('')],
    }
  }
  const lines = sw.text.replace(/\r\n/g, '\n').split('\n')
  const firstItem = lines.findIndex((l) => /^\s*- id: \S/.test(l))
  if (firstItem < 0) {
    return { ok: false, baseId: b.id, baseWhy: b.why, messages: ['基座 preset 里解析不出插件行，没动你的 profile 组合。', ...profileManualHints('')] }
  }
  const baseIndent = /^(\s*)/.exec(lines[firstItem])[1].length
  const delta = 10 - baseIndent
  const shifted = lines.map((l) => {
    if (l.replace(/\s+$/, '') === '') return ''
    return (delta > 0 ? ' '.repeat(delta) : '') + (delta < 0 ? l.slice(-delta) : l)
  })
  while (shifted.length && shifted[shifted.length - 1] === '') shifted.pop()
  const head = [
    '',
    '# ── ' + PRESET_ID + ' 的 agent preset ──────────────────────────────────────────',
    '# 桌面版的预设＝这个 profile 组合里的一行，位置必须在文件末尾的 insert 列表里',
    '# （裸行会被判成 `patch: entry not found`）。这段由 whale-persona 插件写入；',
    '# 要撤掉：删掉这一段，或把同目录的 cordis.patch.yml.bak-<时间戳> 改名回 cordis.patch.yml。',
    '- insert:',
    '    - id: preset-' + PRESET_ID,
    '      name: "@deepseek-ai/dsh-agent-preset"',
    '      config:',
    '        id: ' + PRESET_ID,
    '        name: ' + PRESET_NAME,
    '        description: 基于 ' + b.id + ' 模式 + ' + PERSONA_PKG + ' 人设引擎',
    '        order: 9',
    '        plugins:',
  ]
  return { ok: true, baseId: b.id, baseWhy: b.why, block: head.concat(shifted).join('\n'), baseFile }
}

/**
 * 写后自检：能抓到的结构错都在这里。抓不到"某个字段名在这个桌面版版本里不被认"（那要宿主启动才知道），
 * 所以调用方必须把 .bak 路径一并告诉用户。
 * @returns {string} 空串＝通过，否则是不过的原因
 */
function verifyPatchWrite(next, before) {
  if (next.indexOf(before) !== 0) return '原有内容被动过（不是纯追加）—— 已回滚'
  const p = parsePatchPresets(next)
  if (!p.registryPresent) return 'agent-preset-registry 段不见了 —— 已回滚'
  const mine = p.presets.find((x) => x.hasPersonaRow)
  if (!mine) return '写完解析不出挂着人设的 preset 行 —— 已回滚'
  const added = next.slice(before.length)
  if (/\t/.test(added)) return '新增部分含制表符（YAML 会解析失败）—— 已回滚'
  for (const l of added.split('\n')) {
    if (l.replace(/\s+$/, '') === '') continue
    const ind = /^(\s*)/.exec(l)[1].length
    if (ind % 2 !== 0) return '新增部分有 ' + ind + ' 格缩进的行（层级不是 2 的倍数）—— 已回滚：' + JSON.stringify(l.slice(0, 60))
  }
  return ''
}

/**
 * profile 平面（桌面版）的安装：往 profile 组合末尾**追加**一个 preset 块。
 *
 * 0.17.6 及以前这里是"只读 + 报路"。改成真写（2026-09-29 拍板）的原因是：
 * 桌面版没有任何"插件装好人设就生效"的路径 —— 会话跑的是 registry 的 `default` 预设，
 * 那里面没有人设行，于是市场用户装完的观感永远是「装了没用」；而"自己照面板抄一段 YAML"
 * 对绝大多数用户等于没做。桌面版自己就是用 `- insert:` 装东西的，这段写法与真机跑通的形态同构。
 *
 * 三道闸：① 只在确无 persona 行时动手、只追加不重排；② 写前整份备份；
 * ③ 写后自检（原有内容纯追加 / registry 段在 / 人设行能解析出来 / 无 tab / 缩进是 2 的倍数），
 * 任何一项不过就用备份回滚并把原因原文端出来。
 */
function installInProfilePlane({ home, plane, dryRun }) {
  const st = profilePlaneState(home, plane)
  const file = plane.patchFile
  const messages = []
  if (st.hasPersonaRow) {
    messages.push('桌面版机制：人设已挂在 profile 预设「' + st.displayName + '」（preset id = ' + st.presetIdInPlane + '）：' + file)
    messages.push(st.isDefault
      ? '它已经是新任务默认（selectedDefault = ' + st.presetIdInPlane + '）'
      : '默认 preset 目前是「' + st.defaultPresetId + '」')
    return { ok: true, action: 'kept', dir: file, baseId: '', baseWhy: '', swapped: false, messages }
  }
  if (!file || !existsSync(file)) {
    messages.push('这个 profile 里没有组合文件（' + (file || '未探测到') + '），没动任何东西。')
    messages.push(...profileManualHints(file || ''))
    return { ok: false, action: 'manual', dir: file, baseId: '', baseWhy: '', swapped: false, messages }
  }
  let before = ''
  try { before = readFileSync(file, 'utf8') } catch { before = '' }
  const built = buildProfileInsertBlock(home)
  if (!built.ok) return { ok: false, action: 'manual', dir: file, baseId: built.baseId, baseWhy: built.baseWhy, swapped: false, messages: built.messages }
  if (/^[ \t]*- insert:/m.test(before)) {
    // 已经有 insert 块了：追加第二个也是合法的（列表元素），但先报出来，用户知道文件里有两段。
    messages.push('注意：这份组合里已经有一个 insert 块，下面这段会追加成第二个（同样是列表元素，合法）。')
  }
  const sep = before.endsWith('\n') ? '' : '\n'
  const next = before + sep + built.block + '\n'
  const bad = verifyPatchWrite(next, before)
  if (dryRun) {
    messages.push('DRY: 会在末尾追加一个 preset 块（共 ' + built.block.split('\n').length + ' 行），不会写盘。')
    messages.push('DRY: 追加后的自检结果：' + (bad ? bad.replace(' —— 已回滚', '') : '通过'))
    return { ok: !bad, action: bad ? 'manual' : 'dry', dir: file, baseId: built.baseId, baseWhy: built.baseWhy, swapped: true, messages }
  }
  const bak = file + '.bak-' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  try { writeFileSync(bak, before, 'utf8') } catch {
    messages.push('备份失败（' + bak + '），没写你的组合。')
    return { ok: false, action: 'manual', dir: file, baseId: built.baseId, baseWhy: built.baseWhy, swapped: false, messages }
  }
  if (bad) {
    messages.push('自检没通过：' + bad)
    messages.push('没写盘（自检是在写之前跑的），你的组合一个字节没变。')
    messages.push(...profileManualHints(file))
    return { ok: false, action: 'manual', dir: file, baseId: built.baseId, baseWhy: built.baseWhy, swapped: true, messages }
  }
  try { writeFileSync(file, next, 'utf8') } catch (e) {
    messages.push('写盘失败：' + String(e && e.message ? e.message : e))
    return { ok: false, action: 'manual', dir: file, baseId: built.baseId, baseWhy: built.baseWhy, swapped: true, messages }
  }
  const after = verifyPatchWrite(readFileSync(file, 'utf8'), before)
  if (after) {
    try { writeFileSync(file, before, 'utf8') } catch { messages.push('⚠ 回滚也失败了，请手工把 ' + bak + ' 改名回 cordis.patch.yml') }
    messages.push('写盘后自检没通过：' + after)
    return { ok: false, action: 'manual', dir: file, baseId: built.baseId, baseWhy: built.baseWhy, swapped: true, messages }
  }
  messages.push('preset 「' + PRESET_NAME + '」已写入 profile 组合：' + file)
  messages.push('它是从基座 preset「' + built.baseId + '」克隆的完整工具面 + 人设行（preset id = ' + PRESET_ID + '）。')
  messages.push('备份：' + bak + '  —— 万一宿主起不来，把它改名回 ' + path.basename(file) + ' 即可。')
  messages.push('下一步：点「设为新任务默认」，否则新会话还是走 registry 的默认预设。重启宿主后生效。')
  return { ok: true, action: 'created', dir: file, baseId: built.baseId, baseWhy: built.baseWhy, swapped: true, messages, backup: bak }
}

/**
 * profile 平面的默认化：只改 agent-preset-registry 段的 selectedDefault 一行，改前先备份。
 * 语义与 .agent-presets 平面完全一致：只在"没有默认"或"默认已是本插件"时写；用户另有默认则不动。
 */
function setDefaultInProfilePlane({ plane, dryRun }) {
  const file = plane.patchFile
  let text = ''
  if (file && existsSync(file)) { try { text = readFileSync(file, 'utf8') } catch { text = '' } }
  const p = parsePatchPresets(text)
  const mine = p.presets.find((x) => x.hasPersonaRow) || null
  const planeId = mine ? mine.id : PRESET_ID
  const cur = p.selectedDefault
  if (!p.registryPresent || p.registryLine < 0) return { ok: false, changed: false, reason: '这个 profile 没有 agent-preset-registry 段，没动它', file }
  if (!mine) return { ok: false, changed: false, reason: '人设还没挂进 profile 组合，先挂上再设默认', file }
  if (cur === planeId) return { ok: true, changed: false, reason: '已经是默认 preset（selectedDefault = ' + cur + '）', file }
  if (cur) return { ok: false, changed: false, reason: '用户已有默认 preset「' + cur + '」，没动它', file }
  const lines = text.split(/\r?\n/)
  let target = -1
  let indent = ''
  for (let j = p.registryLine + 1; j < lines.length && !/^- /.test(lines[j]); j++) {
    const m = /^(\s+)(default|selectedDefault):/.exec(lines[j])
    if (!m) continue
    if (!indent) indent = m[1]
    if (m[2] === 'selectedDefault') { target = j; indent = m[1] }
  }
  if (!indent) indent = '  '
  if (target >= 0) lines[target] = indent + 'selectedDefault: ' + planeId
  else lines.splice(p.registryLine + 1, 0, indent + 'selectedDefault: ' + planeId)
  if (dryRun) return { ok: true, changed: true, reason: 'DRY: 会把 selectedDefault 写成 ' + planeId, file }
  const bak = file + '.bak-' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  try { writeFileSync(bak, text, 'utf8') } catch { return { ok: false, changed: false, reason: '备份失败，没动它（' + file + '）', file } }
  writeFileSync(file, lines.join('\n'), 'utf8')
  return { ok: true, changed: true, reason: 'selectedDefault = ' + planeId + '（新会话生效）；备份：' + bak, file }
}

/**
 * 建/修 preset（幂等）。
 * @returns {{ok: boolean, action: 'kept'|'created'|'dry'|'no-base'|'manual', dir: string,
 *            baseId: string, baseWhy: string, swapped: boolean, messages: string[]}}
 */
export function installPreset({ home, base = 'auto', dryRun = false } = {}) {
  const plane = detectPresetPlane(home)
  if (plane.plane === 'profile') return installInProfilePlane({ home, plane, dryRun })
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
  const plane = detectPresetPlane(home)
  if (plane.plane === 'profile') return setDefaultInProfilePlane({ plane, dryRun })
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
