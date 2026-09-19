/**
 * 人设预设库（0.10.0 新增）——人设变成**可切换、可分享、可导入导出的文件**。
 *
 * 与 core/presets.js（语气预设，只是几条现成文案）不是一回事：这里是**人格快照的存取与应用**。
 * 为什么住 core：面板 / 本地编辑页 / CLI 都从这里取，三处各写一份必然漂移
 * （与 core/edit.js 同一套读写纪律）。
 *
 * 语义（一次性应用，config.json 仍是单一真源）：
 *   应用预设 = 把**预设里出现的那些 persona 字段**写进 config.persona（没出现的字段保持原样），
 *   应用后可随意微调；应用前先把现状存成 autosave（「上次的人设」），随时切回，绝不丢手工调整。
 *
 * 两条与"分享"直接相关的设计决定：
 *   ① **预设不携带长期记忆**。记忆是"你与这个 AI 之间发生过的事"，不是人格的一部分 ——
 *      别人的卡不该覆盖你的记忆（也堵住借分享卡往记忆里塞东西的路）。
 *   ② 预设里**出现的字段才覆盖**；兼容套件版/早期格式（只有 character+contracts 的文件照旧能用）。
 *
 * 目录（沿用 store.js 的旧布局兼容口径）：$DSH_HOME/whale-persona/presets/；
 * 若 $DSH_HOME/whale-suite/config.json 存在（早期布局），用 $DSH_HOME/whale-suite/presets/。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { dshHome } from './store.js'
import { readRawConfig, writeMergedConfig } from './edit.js'

/** 预设文件格式版本（写文件时带上；老文件没这个键 = 早期格式，照旧接受） */
export const PRESET_SPEC = 'whale-persona-preset/1'

/** 预设能覆盖的 persona 子键（其余 persona 键一律不动） */
export const PERSONA_KEYS = [
  'userName', 'selfNameFlash', 'selfNamePro', 'selfNameByModel',
  'stance', 'character', 'suffix', 'contracts', 'tone', 'appearance',
]

export function presetsDir() {
  const home = dshHome()
  const legacy = path.join(home, 'whale-suite')
  try {
    if (statSync(path.join(legacy, 'config.json')).isFile()) return path.join(legacy, 'presets')
  } catch { /* 无旧布局：用新目录 */ }
  return path.join(home, 'whale-persona', 'presets')
}

/** 预设 id 即文件名：只认字母数字_-（挡路径穿越） */
export function safeId(id) {
  const s = String(id == null ? '' : id).trim()
  return /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : null
}

export function presetFile(id) {
  const safe = safeId(id)
  return safe ? path.join(presetsDir(), safe + '.json') : ''
}

/**
 * 种子预设（只补缺，绝不覆盖用户改过的）：
 * blank = 纯引擎零观点（默认语义）；starter = 五条中性通用契约，"装上就有点用"。
 * 注意：**播种不等于应用** —— 装上不会改变任何行为，要用户自己点应用。
 */
const STARTER_CONTRACTS = [
  { id: 'terse', text: '结论先行，默认精简；能三句说完不写三段，能列点不写散文。', on: true },
  { id: 'evidence', text: '结论要有依据（命令输出、文件内容、报错原文）；拿不到证据就说「没验证」，不编。', on: true },
  { id: 'honest', text: '不确定就直说，并给出最小验证方法；不为了迎合而附和。', on: true },
  { id: 'finish-first', text: '一次做完：不被反复问「还要不要继续」；除非遇到只有用户能拍板的岔路，一路做到能交付为止。', on: true },
  { id: 'no-followup-question', text: '结尾不要出现征询式问句（「需要我继续吗」「还要什么吗」）；真要拍板就把选项、取舍、推荐一次列清。', on: true },
]

export const SEED_PRESETS = [
  { spec: PRESET_SPEC, id: 'blank', label: '空白 · 纯引擎零观点', description: '全部留给自己填（默认即此语义）', persona: { character: '', contracts: [] } },
  { spec: PRESET_SPEC, id: 'starter', label: '起步 · 五条通用工作契约', description: '中性起步集：装上即有点用，逐条可关可改', persona: { character: '', contracts: STARTER_CONTRACTS } },
]

export function ensureSeeds() {
  try {
    mkdirSync(presetsDir(), { recursive: true })
    for (const p of SEED_PRESETS) {
      const f = presetFile(p.id)
      if (f && !existsSync(f)) writeFileSync(f, JSON.stringify(p, null, 2) + '\n', 'utf8')
    }
    return true
  } catch {
    return false
  }
}

/** 解析文件内容 → 统一形状；不是预设返回 null（坏形状一律不猜） */
export function normalizePreset(raw, fallbackId) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const inner = raw.persona && typeof raw.persona === 'object' && !Array.isArray(raw.persona) ? raw.persona : null
  const hasLegacy = typeof raw.character === 'string' || Array.isArray(raw.contracts)
  if (!inner && !hasLegacy) return null
  const persona = {}
  if (inner) {
    for (const k of PERSONA_KEYS) {
      if (Object.prototype.hasOwnProperty.call(inner, k)) persona[k] = inner[k]
    }
  }
  if (hasLegacy) { // 套件版 / 早期格式：字段在顶层
    if (Array.isArray(raw.contracts)) persona.contracts = raw.contracts
    if (typeof raw.character === 'string' && raw.character) persona.character = raw.character
  }
  return {
    spec: typeof raw.spec === 'string' ? raw.spec : '',
    id: safeId(raw.id) || safeId(fallbackId) || '',
    label: String(raw.label || raw.name || raw.id || fallbackId || '').trim(),
    description: String(raw.description || '').trim(),
    author: String(raw.author || raw.creator || '').trim(),
    tags: Array.isArray(raw.tags) ? raw.tags.map((t) => String(t)).filter(Boolean).slice(0, 32) : [],
    thinkingLanguage: typeof raw.thinkingLanguage === 'string' ? raw.thinkingLanguage : undefined,
    persona,
  }
}

/** 列出全部预设（单个文件读不了就跳过，不牵连整个目录） */
export function listPresets() {
  ensureSeeds()
  const out = []
  try {
    for (const name of readdirSync(presetsDir()).sort()) {
      if (!name.toLowerCase().endsWith('.json')) continue
      try {
        const raw = JSON.parse(readFileSync(path.join(presetsDir(), name), 'utf8'))
        const p = normalizePreset(raw, name.replace(/\.json$/i, ''))
        if (!p) continue
        out.push({
          id: p.id, label: p.label, description: p.description, author: p.author, tags: p.tags,
          spec: p.spec, file: name,
          contracts: Array.isArray(p.persona.contracts) ? p.persona.contracts.length : 0,
          hasCharacter: typeof p.persona.character === 'string' && p.persona.character.trim().length > 0,
          hasTone: !!(p.persona.tone && p.persona.tone.text),
          hasAppearance: !!(p.persona.appearance && p.persona.appearance.text),
        })
      } catch { /* 坏文件跳过 */ }
    }
  } catch { /* 目录读不了：空表 */ }
  return out
}

/** 读单个预设（坏 JSON / 越界 id 一律 null） */
export function loadPreset(id) {
  const f = presetFile(id)
  if (!f) return null
  try {
    return normalizePreset(JSON.parse(readFileSync(f, 'utf8')), safeId(id))
  } catch {
    return null
  }
}

/** 写预设文件（同 id 覆盖）。返回写出的文件路径，失败 null */
export function savePreset(preset) {
  const id = safeId(preset && preset.id)
  if (!id) return null
  try {
    mkdirSync(presetsDir(), { recursive: true })
    const body = {
      spec: PRESET_SPEC,
      id,
      label: String(preset.label || id),
      description: String(preset.description || ''),
    }
    if (preset.author) body.author = String(preset.author)
    if (Array.isArray(preset.tags) && preset.tags.length) body.tags = preset.tags.map((t) => String(t))
    if (typeof preset.thinkingLanguage === 'string') body.thinkingLanguage = preset.thinkingLanguage
    body.persona = preset.persona && typeof preset.persona === 'object' ? preset.persona : {}
    const f = presetFile(id)
    writeFileSync(f, JSON.stringify(body, null, 2) + '\n', 'utf8')
    return f
  } catch {
    return null
  }
}

export function deletePreset(id) {
  const f = presetFile(id)
  if (!f || !existsSync(f)) return false
  try {
    rmSync(f)
    return true
  } catch {
    return false
  }
}

/** 从当前配置抽出可分享的那部分（**不含记忆**，见文件头注） */
export function presetFromConfig(cfg, meta) {
  const p = (cfg && cfg.persona) || {}
  const persona = {}
  for (const k of PERSONA_KEYS) {
    if (Object.prototype.hasOwnProperty.call(p, k)) persona[k] = JSON.parse(JSON.stringify(p[k]))
  }
  const out = {
    id: safeId(meta && meta.id) || '',
    label: String((meta && meta.label) || (meta && meta.id) || ''),
    description: String((meta && meta.description) || ''),
    persona,
  }
  if (meta && meta.author) out.author = String(meta.author)
  if (cfg && typeof cfg.thinkingLanguage === 'string') out.thinkingLanguage = cfg.thinkingLanguage
  return out
}

/**
 * 应用到**磁盘**（CLI 与设置面板共用这一段，别各写一份）：
 *   ① 现状与目标不同 → 先把现状存成 autosave（「上次的人设」），随时切回；
 *   ② 只把 persona / thinkingLanguage 两个**已知段**写回（未知键与别的段照旧保留）；
 *   ③ 现有 config.json 是坏 JSON → 拒绝写入，返回可读错误。
 * 返回 { ok, file, autosave, error }
 */
export function applyPresetToFile(preset, opts) {
  const file = opts && opts.file
  try {
    const raw = readRawConfig(file)
    if (raw === null) return { ok: false, error: '现有 config.json 不是合法 JSON，先修好它（本次不会覆盖坏文件）' }
    const current = presetFromConfig(raw, {})
    const same = PERSONA_KEYS.every((k) => JSON.stringify(current.persona[k]) === JSON.stringify((preset.persona || {})[k]))
    let autosave = ''
    if (!same) {
      autosave = savePreset({ id: 'autosave', label: '上次的人设（自动保存）', description: '切换预设前的现场', persona: current.persona }) || ''
    }
    const next = applyPresetToConfig(raw, preset)
    const patch = { persona: next.persona }
    if (typeof preset.thinkingLanguage === 'string') patch.thinkingLanguage = preset.thinkingLanguage
    writeMergedConfig(patch, file)
    return { ok: true, file: file || '', autosave }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
}

/**
 * 把预设应用到一份**原始配置**上，返回新配置（纯函数，不落盘）。
 * 只覆盖预设里出现的键 —— 没出现的 persona 字段、以及别的工具的段，一律原样保留。
 */
export function applyPresetToConfig(rawCfg, preset) {
  const cfg = rawCfg && typeof rawCfg === 'object' && !Array.isArray(rawCfg) ? rawCfg : {}
  const p = preset && preset.persona && typeof preset.persona === 'object' ? preset.persona : {}
  const persona = { ...(cfg.persona && typeof cfg.persona === 'object' ? cfg.persona : {}) }
  for (const k of PERSONA_KEYS) {
    if (Object.prototype.hasOwnProperty.call(p, k) && p[k] !== null && p[k] !== undefined) {
      persona[k] = JSON.parse(JSON.stringify(p[k]))
    }
  }
  const next = { ...cfg, persona }
  if (typeof preset.thinkingLanguage === 'string') next.thinkingLanguage = preset.thinkingLanguage
  return next
}
