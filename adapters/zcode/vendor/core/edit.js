/**
 * 配置读写纪律（宿主无关的唯一源）
 *
 * 2026-09-18 从 scripts/ui.mjs 提上来：本地编辑器页与 DSH 设置面板必须**同一套**读写与告警逻辑，
 * 否则「面板里能填的」和「本地页里能填的」会各写各的，用户看到两套行为。
 *
 * 三条纪律（照抄本地编辑器，别改口径）：
 *   ① 只替换已知段（enabled / thinkingLanguage / persona / memory），**未知键原样保留** ——
 *      配置可能与其他工具共存（context / forge / tools 等段），裁掉别人的段是数据丢失；
 *   ② 现有文件不是合法 JSON 时**拒绝写入**（返回 null / 抛错），绝不覆盖坏文件；
 *   ③ 写入用整体读改写，写完重读校验。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DEFAULTS, mergeConfig } from './defaults.js'
import { buildPersonaPrompt, buildSuffix, buildThinkingLanguage } from './prompt.js'
import { pickByModel } from './render.js'
import { captureMode } from './capture.js'
import { STATUS, readInbox, readPending, resolveInbox } from './memoryInbox.js'
import { configPath } from './store.js'

/** 写回时允许整体替换的已知段（其余键一律原样保留） */
export const PATCHABLE_KEYS = ['enabled', 'thinkingLanguage', 'persona', 'memory']

/** 读原始配置（保留未知键）。文件不存在 = {}；**不是合法 JSON = null**（调用方必须拒绝写入） */
export function readRawConfig(file) {
  const f = file || configPath()
  try {
    if (!existsSync(f)) return {}
    const parsed = JSON.parse(readFileSync(f, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * 整体读改写：patch 里出现的已知段整体替换，未知键与其他已知段原样保留。
 * 现有文件是坏 JSON 时抛错——交给调用方回一个可读的错误，绝不静默覆盖。
 */
export function writeMergedConfig(patch, file) {
  const f = file || configPath()
  const raw = readRawConfig(f)
  if (raw === null) throw new Error('现有 config.json 不是合法 JSON，先修好它（本页不会覆盖坏文件）')
  const next = { ...raw }
  for (const key of PATCHABLE_KEYS) {
    if (patch && Object.prototype.hasOwnProperty.call(patch, key)) next[key] = patch[key]
  }
  mkdirSync(path.dirname(f), { recursive: true })
  writeFileSync(f, JSON.stringify(next, null, 2) + '\n', 'utf8')
  return next
}

/**
 * 形象 / 语气的静默失效点名（0.9.0）：这两段都是 opt-in + 按模型覆盖，
 * 「填了没开」「开了没填」「按模型条目没命中且没有通用兜底」三种都极容易让人以为插件坏了。
 */
function styleWarnings(out, label, field, model) {
  const f = field && typeof field === 'object' && !Array.isArray(field) ? field : {}
  const on = f.enabled === true
  const text = String(f.text == null ? '' : f.text).trim()
  const table = (f.byModel && typeof f.byModel === 'object' && !Array.isArray(f.byModel)) ? f.byModel : {}
  const rows = Object.keys(table).filter((k) => String(table[k] == null ? '' : table[k]).trim())
  const hit = pickByModel(table, model)
  if (!on) {
    if (text || rows.length) out.push('「' + label + '」已经填了内容，但开关是关的 —— 不会注入（这一段默认关，属于 opt-in）。')
    return
  }
  if (!text && !rows.length) {
    out.push('「' + label + '」开关开着，但通用内容和按模型条目都是空的 —— 注入里不会出现这一段。')
    return
  }
  if (!hit && !text && rows.length) {
    out.push('「' + label + '」只有 ' + rows.length + ' 条按模型条目、没有通用内容，当前模型 ' + String(model || '') + ' 一条都没命中 —— 这个模型下不会注入。')
  }
}

/** 配了却不会生效的项 —— 静默失效是配置界面最坑人的地方，这里主动点名 */
export function configWarnings(cfg, model) {
  const out = []
  const p = (cfg && cfg.persona) || {}
  const pro = String(model || 'flash').toLowerCase().includes('pro')
  const selfName = (pro ? (p.selfNamePro || p.selfNameFlash) : p.selfNameFlash) || ''
  const table = (p.selfNameByModel && typeof p.selfNameByModel === 'object' && !Array.isArray(p.selfNameByModel)) ? p.selfNameByModel : {}
  const tableNames = Object.keys(table).map((k) => String(table[k] == null ? '' : table[k]).trim()).filter(Boolean)
  const texts = [p.stance, p.character, (p.appearance || {}).text, (p.tone || {}).text]
    .concat((p.contracts || []).map((c) => c && c.text))
  const usesPlaceholder = texts.some((t) => typeof t === 'string' && t.includes('{selfName}'))
  const named = [selfName].concat(tableNames).filter((n) => n && n !== '我')
  if (named.length && !usesPlaceholder) {
    const shown = named.slice(0, 3).map((n) => '「' + n + '」').join('、') + (named.length > 3 ? ' 等' : '')
    out.push('自称 ' + shown + ' 不会出现在提示词里：它只通过 {selfName} 占位符生效 —— 写进「立场正文」或任一条契约里即可。')
  }
  const m = (cfg && cfg.memory) || {}
  const entries = (m.entries || []).filter((x) => x && x.on !== false && x.text)
  if (entries.length && m.enabled !== true) {
    out.push('有 ' + entries.length + ' 条手工条目，但「长期记忆」总开关是关的 —— 它们不会被注入。')
  }
  if (m.enabled === true && m.inbox !== false) {
    // 确认闸门（0.8.0）：待确认候选与老格式条目都不注入 —— 不点名的话，用户只会看到"记忆凭空少了"
    try {
      // 口径必须与设置面板记忆卡上的「收件箱 N 行」是同一个数 = **全部条目数**，不是待确认数
      // （0.11.2 的错误：分母写成了"待确认数"，于是横幅"1 行"与卡片"3 行"继续对不上）
      const all = readInbox(resolveInbox(m.inboxPath))
      const pending = readPending(resolveInbox(m.inboxPath))
      const proposed = pending.filter((e) => e.status === STATUS.proposed).length
      const legacy = pending.filter((e) => e.status === STATUS.legacy).length
      if (proposed) out.push('收件箱 ' + all.length + ' 行里有 ' + proposed + ' 条待确认候选：不注入。确认后才生效 —— node scripts/memory.mjs status 看序号，再 confirm <序号>。')
      if (legacy && m.requireConfirm !== false) out.push('收件箱里有 ' + legacy + ' 条老格式条目（没有 status）：0.8.0 起默认不注入。用 node scripts/memory.mjs adopt 一次性确认，或把 memory.requireConfirm 设为 false 放行。')
    } catch { /* 收件箱读不动就不提示 */ }
  }
  if (m.enabled === true && m.capture === 'always' && m.inbox !== false) {
    out.push('收口模式是 always：每一轮都会注入【入库纪律】（旧行为）。想按需用，改成 on-demand 并在会话里 /memory on。')
  }
  styleWarnings(out, '形象', p.appearance, model)
  styleWarnings(out, '语气', p.tone, model)
  const contracts = (p.contracts || []).filter((c) => c && c.text)
  if (contracts.length > 12) {
    out.push('契约有 ' + contracts.length + ' 条：超过 12 条会互相稀释，建议合并成更少、更具体的条目。')
  }
  const long = contracts.filter((c) => typeof c.text === 'string' && c.text.length > 120)
  if (long.length) {
    out.push('有 ' + long.length + ' 条契约超过 120 字：契约要具体可验证，长段落更适合放进「立场正文」。')
  }
  return out
}

/** 把任意配置渲染成实际注入的三段 + 告警（预览与面板共用） */
export function renderSections(cfgRaw, opts) {
  const model = (opts && opts.model) || 'flash'
  const cwd = (opts && opts.cwd) || ''
  const cfg = mergeConfig(cfgRaw)
  const capture = opts && Object.prototype.hasOwnProperty.call(opts, 'capture')
    ? !!opts.capture
    : captureMode(cfg) === 'always'
  const safe = (fn, fallback) => { try { return fn() } catch { return fallback } }
  return {
    prefix: safe(() => buildPersonaPrompt(cfg, model, cwd, { capture }), ''),
    thinking: safe(() => buildThinkingLanguage(cfg), ''),
    suffix: safe(() => buildSuffix(cfg, cwd), ''),
    mode: captureMode(cfg),
    capture,
    warnings: configWarnings(cfg, model),
  }
}

export { DEFAULTS, mergeConfig, configPath }
