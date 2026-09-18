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
import { captureMode } from './capture.js'
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

/** 配了却不会生效的项 —— 静默失效是配置界面最坑人的地方，这里主动点名 */
export function configWarnings(cfg, model) {
  const out = []
  const p = (cfg && cfg.persona) || {}
  const pro = String(model || 'flash').toLowerCase().includes('pro')
  const selfName = (pro ? (p.selfNamePro || p.selfNameFlash) : p.selfNameFlash) || ''
  const texts = [p.stance, p.character].concat((p.contracts || []).map((c) => c && c.text))
  const usesPlaceholder = texts.some((t) => typeof t === 'string' && t.includes('{selfName}'))
  if (selfName && selfName !== '我' && !usesPlaceholder) {
    out.push('自称「' + selfName + '」不会出现在提示词里：它只通过 {selfName} 占位符生效 —— 写进「立场正文」或任一条契约里即可。')
  }
  const m = (cfg && cfg.memory) || {}
  const entries = (m.entries || []).filter((x) => x && x.on !== false && x.text)
  if (entries.length && m.enabled !== true) {
    out.push('有 ' + entries.length + ' 条手工条目，但「长期记忆」总开关是关的 —— 它们不会被注入。')
  }
  if (m.enabled === true && m.capture === 'always' && m.inbox !== false) {
    out.push('收口模式是 always：每一轮都会注入【入库纪律】（旧行为）。想按需用，改成 on-demand 并在会话里 /memory on。')
  }
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
