/**
 * 注入体积计量与预算（0.13.0）。
 *
 * 为什么：本插件的价值主张里有"省 token"这一条，但在此之前**没人看得见**它每轮到底注入多少——
 * 2026-09-20 实测某份真实配置：合计约 1.6k 字符，其中工作契约约占七成。没有量，就没有优化与取舍。
 *
 * 口径（唯一真源）：本模块不自己重算文本，而是调用与渲染同一条通路
 * （buildPersonaParts / buildSuffix / buildThinkingLanguage），把**实际会被注入的字符串长度**相加。
 * 因此 tests/inject-size.mjs 能钉住恒等式：三段实测长度之和 == 计量合计（+ 超预算提醒行）。
 *
 * 预算只**提醒**，永不自动裁剪：
 *   · budget.enabled=false（默认）→ 连提醒行都不注入，装上零行为改变；
 *   · enabled=true 且 max>0 且合计超限 → 可选在末尾注入一行提醒（warnInPrompt），让 AI 主动告知用户。
 */
import { buildPersonaParts, buildSuffix, buildThinkingLanguage } from './prompt.js'

/** 段落标签（面板 / CLI 展示用，key 不变） */
export const PART_LABELS = {
  persona: '人设正文',
  inbox: '历史备忘',
  discipline: '入库纪律',
  suffix: '末尾段',
  thinking: '思考语言',
}

/** 预算配置归一化：只认 enabled / max / warnInPrompt，坏形状回落关 */
export function budgetOf(cfg) {
  const b = (cfg && cfg.budget) || {}
  const max = Number(b.max) > 0 ? Number(b.max) : 0
  return { enabled: b.enabled === true, max, warnInPrompt: b.warnInPrompt !== false }
}

/**
 * 计量一次渲染的注入体积。
 * @param cfg 归一化后的配置（mergeConfig 的产物；传原始配置会因缺默认值而算少）
 * @param opts { model, cwd, capture }
 * @returns { parts, total, budget:{enabled,max,over,note} }
 *   parts = [{ key, label, chars }]；total = 各段之和（**不含**超预算提醒行自身）
 */
export function measureInjection(cfg, opts) {
  const o = opts || {}
  const parts = []
  try {
    const p = buildPersonaParts(cfg, o.model, o.cwd, { capture: !!o.capture })
    parts.push({ key: 'persona', label: PART_LABELS.persona, chars: p.persona.length })
    parts.push({ key: 'inbox', label: PART_LABELS.inbox, chars: p.inbox.length })
    parts.push({ key: 'discipline', label: PART_LABELS.discipline, chars: p.discipline.length })
  } catch { /* 渲染炸了：计 0，不抛 */ }
  try { parts.push({ key: 'suffix', label: PART_LABELS.suffix, chars: buildSuffix(cfg, o.cwd).length }) } catch { /* 同上 */ }
  try { parts.push({ key: 'thinking', label: PART_LABELS.thinking, chars: buildThinkingLanguage(cfg).length }) } catch { /* 同上 */ }

  const total = parts.reduce((a, x) => a + x.chars, 0)
  const budget = budgetOf(cfg)
  const over = budget.enabled && budget.max > 0 && total > budget.max
  const note = over && budget.warnInPrompt ? budgetNote(cfg, total, budget.max) : ''
  return { parts, total, budget: { ...budget, over, note, noteChars: note.length } }
}

/** 超预算提醒行（注入在末尾段之后）。默认关；内容只陈述事实与动作，不许 AI 自行改配置 */
export function budgetNote(cfg, total, max) {
  const name = (cfg && cfg.persona && cfg.persona.userName) || '用户'
  return '\n[whale-persona] 人设注入超预算：合计 ' + total + ' 字符 / 预算 ' + max + ' 字符。'
    + '请提醒 ' + name + ' 精简（工作契约、记忆条目、条件反射规则都可查体积），不要自行删改他的配置。'
}

/** 末尾段 = 用户自定义 suffix + 可选预算提醒行（适配器与计量共用这一条通路） */
export function buildSuffixSection(cfg, model, cwd, capture) {
  let suffix = ''
  try {
    suffix = buildSuffix(cfg, cwd)
  } catch {
    suffix = ''
  }
  try {
    const m = measureInjection(cfg, { model, cwd, capture })
    return suffix + (m.budget.note || '')
  } catch {
    return suffix
  }
}
