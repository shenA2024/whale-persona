/**
 * 匹配层：三条通道，从硬到软。
 *
 * 触发来源：2026-09-20 用户需求：条件反射只有固定问题才有效吗？其他用户设了别的，我担心还是固定问题才有固定答案」。
 * 诚实前提：**不调用模型的匹配只能抓「形式」**，抓不住「意思」。所以这里不假装懂语义，而是给三层：
 *   ① text      —— 正则，精确通道（误伤最低，但只能覆盖写出来的说法）
 *   ② nearAny   —— 归一化后子串（去空白/标点/全角、繁简归一），写人话即可，不用写正则
 *   ③ keywords  —— 概念词袋，命中 ≥ minHits 个即**软命中**；软命中会在指令里附「不符就完全忽略本条」
 * 顺序：① → ② → ③，**命中即唯一命中**（不做叠加）。
 */

/** flash/pro/other —— 与 dsh-whale-persona/lib/render.js:tierOf 同口径 */
export function tierOf(model) {
  const m = typeof model === 'string' ? model : ''
  if (/pro/i.test(m)) return 'pro'
  if (/flash/i.test(m)) return 'flash'
  return 'other'
}

/** 按顺序取出所有 user 文本块 */
export function userTexts(messages) {
  const parts = []
  for (const m of messages || []) {
    if (!m || m.role !== 'user') continue
    for (const block of m.content || []) {
      if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    }
  }
  return parts
}

/** 归一化：全角→半角、去空白与标点、繁简常见差异、小写化。只做「形式比对」，不做语义。 */
export function normalize(text) {
  return String(text || '')
    .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[\s，,。.！!？?、；;：:「」“”‘’（）()【】\[\]…~～\-]/g, '')
    .replace(/[妳您]/g, '你')
    .replace(/[嗎嘛]/g, '吗')
    .replace(/[麼么]/g, '么')
    .replace(/[誰]/g, '谁')
    .replace(/[認識]/g, '认')
    .toLowerCase()
    .trim()
}

function reMatch(pattern, text) {
  if (!pattern) return false
  try {
    return new RegExp(pattern, 'i').test(String(text || ''))
  } catch {
    return false
  }
}

/** 反例否决：命中即整条规则作废（三条通道都适用） */
function vetoed(w, ctx) {
  return Boolean(w.textNot && reMatch(w.textNot, ctx.text))
}

/**
 * @returns {null | {soft:boolean, why:string}}
 */
export function matchKind(rule, ctx) {
  const w = (rule && rule.when) || {}
  if (w.tier && w.tier !== 'any' && w.tier !== ctx.tier) return null
  if (w.model && !reMatch(w.model, ctx.model)) return null
  if (w.maxChars && String(ctx.text || '').length > Number(w.maxChars)) return null
  if (ctx.fired && rule.oncePerSession === true && ctx.fired.has(rule.id)) return null
  if (vetoed(w, ctx)) return null

  if (w.text && reMatch(w.text, ctx.text)) return { soft: false, why: 'text' }

  const norm = ctx.normalized != null ? ctx.normalized : normalize(ctx.text)
  const near = Array.isArray(w.nearAny) ? w.nearAny : []
  for (const phrase of near) {
    const p = normalize(phrase)
    if (!p) continue
    const at = norm.indexOf(p)
    if (at < 0) continue
    // 第三人称护栏：'他认得我吗' 里的 '认得我吗' 不是问"你"，不该命中（语料回归实测踩到）
    const before = at > 0 ? norm.slice(Math.max(0, at - 2), at) : ''
    if (/[他她它]|别人|他们/.test(before)) continue
    return { soft: false, why: 'near:' + phrase }
  }

  const kws = Array.isArray(w.keywords) ? w.keywords : []
  if (kws.length) {
    const need = Number(w.minHits) > 0 ? Number(w.minHits) : 2
    const hit = kws.filter((k) => norm.includes(normalize(k)))
    if (hit.length >= need) return { soft: true, why: 'keywords:' + hit.join('+') }
  }
  return null
}

export function ruleMatches(rule, ctx) {
  return matchKind(rule, ctx) !== null
}

/** 高优先级优先；同优先级保持文件内顺序（稳定）。返回 {rule, soft, why} 或 null。 */
export function matchRule(rules, ctx) {
  const list = (rules || []).map((r, i) => ({ r, i }))
    .sort((a, b) => (Number(b.r.priority) || 0) - (Number(a.r.priority) || 0) || a.i - b.i)
  for (const { r } of list) {
    const kind = matchKind(r, ctx)
    if (kind) return { rule: r, soft: kind.soft, why: kind.why }
  }
  return null
}
