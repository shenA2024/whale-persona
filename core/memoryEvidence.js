/** Evidence describes a memory; it never confirms it or grants authority. */
import path from 'node:path'

const fold = (v) => typeof v === 'string' ? v.trim().replace(/[\r\n]+/g, ' ') : ''
export function evidenceOf(raw) {
  const out = {}
  const enums = {
    source: ['user', 'assistant', 'document', 'system', 'tool', 'mixed'],
    basis: ['direct', 'reported', 'observed', 'inferred', 'mixed'],
    confidence: ['high', 'medium', 'low'],
  }
  for (const [key, allowed] of Object.entries(enums)) {
    if (allowed.includes(raw?.[key])) out[key] = raw[key]
  }
  for (const key of ['sourceRef', 'condition', 'notApplicable', 'topic']) {
    const value = fold(raw?.[key]).slice(0, 500)
    if (value) out[key] = value
  }
  // Preserve an invalid scope so applicability can DEFER it, never silently broaden it.
  if (raw && Object.hasOwn(raw, 'scope')) out.scope = raw.scope
  return out
}

export function applicability(entry, { cwd = '', context = '', now = Date.now() } = {}) {
  if (!Object.hasOwn(entry, 'scope')) return { state: 'ACCEPT', reason: 'unscoped' }
  const s = entry.scope
  if (!s || typeof s !== 'object' || Array.isArray(s)) return { state: 'DEFER', reason: 'invalid_scope' }
  if (Object.keys(s).some((k) => !['projects', 'contexts', 'validFrom', 'validUntil'].includes(k))) {
    return { state: 'DEFER', reason: 'unknown_scope_key' }
  }
  const instant = typeof now === 'number' ? now : Date.parse(now)
  if (!Number.isFinite(instant)) return { state: 'DEFER', reason: 'invalid_clock' }
  for (const key of ['projects', 'contexts']) {
    if (!Object.hasOwn(s, key)) continue
    if (!Array.isArray(s[key]) || !s[key].length || s[key].some((x) => !fold(x))) {
      return { state: 'DEFER', reason: 'invalid_' + key }
    }
  }
  const times = {}
  for (const key of ['validFrom', 'validUntil']) {
    if (!Object.hasOwn(s, key)) continue
    // Require an explicit zone: local host timezone must not decide memory validity.
    if (typeof s[key] !== 'string' || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(s[key])) {
      return { state: 'DEFER', reason: 'invalid_' + key }
    }
    times[key] = Date.parse(s[key])
    if (!Number.isFinite(times[key])) return { state: 'DEFER', reason: 'invalid_' + key }
  }
  if (times.validFrom !== undefined && times.validUntil !== undefined && times.validFrom >= times.validUntil) {
    return { state: 'DEFER', reason: 'invalid_time_range' }
  }
  if (times.validFrom !== undefined && instant < times.validFrom) return { state: 'REJECT', reason: 'not_yet_valid' }
  if (times.validUntil !== undefined && instant >= times.validUntil) return { state: 'REJECT', reason: 'expired' }
  if (s.projects) {
    if (!cwd) return { state: 'DEFER', reason: 'project_missing' }
    const project = path.posix.basename(cwd.replace(/\\/g, '/').replace(/\/+$/, '')).toLowerCase()
    if (!s.projects.some((x) => x.toLowerCase() === project)) return { state: 'REJECT', reason: 'other_project' }
  }
  if (s.contexts) {
    if (!context) return { state: 'DEFER', reason: 'context_missing' }
    if (!s.contexts.includes(context)) return { state: 'REJECT', reason: 'other_context' }
  }
  return { state: 'ACCEPT', reason: 'scope_matched' }
}

export function evidenceText(entry) {
  const e = evidenceOf(entry)
  return Object.entries(e).map(([k, v]) => k + ':' + (typeof v === 'object' ? JSON.stringify(v) : v)).join('; ')
}

/** Deterministic Chinese bigram / Latin word overlap, not semantic understanding. */
export function relevance(text, query) {
  const tokens = (s) => {
    const lower = String(s || '').normalize('NFKC').toLowerCase()
    const out = new Set(lower.match(/[a-z0-9_]+/g) || [])
    for (const chunk of lower.match(/[\p{Script=Han}]+/gu) || []) {
      const chars = [...chunk]
      if (chars.length === 1) out.add(chunk)
      for (let i = 0; i + 1 < chars.length; i++) out.add(chars[i] + chars[i + 1])
    }
    return out
  }
  const a = tokens(text), b = tokens(query)
  if (!b.size) return 0
  let hits = 0
  for (const token of b) if (a.has(token)) hits++
  return hits / b.size
}
