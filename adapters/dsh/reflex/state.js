/**
 * state —— 面板/脚本共用的「当前反射状态」快照（纯函数，可离线单测）。
 * 关键纪律：**区分「文件里写的」与「当前生效的」**——文件坏了或被关掉时，必须能报出来，
 * 否则用户会被假状态骗（这是本项目对「只读展示」的硬要求）。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { configDir } from '../../../core/store.js'
import { loadRules, rulesPath } from './rules.js'
import { matchRule, tierOf, normalize } from './match.js'

const MAX_LOG = 512 * 1024

function logStats(file) {
  const out = { file, rows: 0, fire: 0, dryRun: 0, error: 0, byRule: {}, last: null }
  try {
    if (!existsSync(file) || statSync(file).size > MAX_LOG) return out
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue
      let r = null
      try { r = JSON.parse(line) } catch { continue }
      out.rows++
      if (r.phase === 'fire') { out.fire++; out.byRule[r.rule] = (out.byRule[r.rule] || 0) + 1 }
      else if (r.phase === 'dry-run') out.dryRun++
      else if (r.phase === 'error') out.error++
      out.last = r
    }
  } catch { /* 读不了就当空台账 */ }
  return out
}

/**
 * 试命中（纯函数，**与运行时同一份匹配代码**）。
 *
 * 教训一（2026-09-20，用户截图指出）：最初面板的试命中是**浏览器里另写了一遍正则匹配**，
 * 只测了 text 通道 → 用户看到「不会命中」，而服务端其实会命中（near/keywords 通道）。
 * 两处实现 = 两个真源 = 必然漂移。现在只留这一个：路由 /reflex/api/test 调它，面板调路由。
 *
 * 教训二（2026-09-20 第二次，用户截图：「咱俩什么关系」被面板判成「不会命中任何规则」，而实际会命中）：
 * 面板不带档位调用 → 旧实现兜成 tierOf('') = 'other'，而规则是 flash/pro 分档写的 →
 * matchKind 的**档位闸门**先把规则全否决了，面板报「不会命中」。面板说谎比没有面板更坏。
 * 现在的档位语义（**只影响试命中，运行时一格没动**）：
 *   · 给了 tier / model → 按那一档单判（与真实会话同路径）；
 *   · 没给 → **跨档试**：flash → pro → other 各判一次，把所有命中连同所在档位一起报出来。
 */

/** 试命中要试的档位（顺序 = 报告顺序；真实会话只会是其中一个） */
export const TRIAL_TIERS = ['flash', 'pro', 'other']

export function reflexTest(text, tier, model) {
  const cfg = loadRules()
  const m = model || ''
  const explicit = tier || (m ? tierOf(m) : '')
  const tiersTried = explicit ? [explicit] : TRIAL_TIERS.slice()
  const hits = []
  for (const t of tiersTried) {
    const hit = matchRule(cfg.rules, { text, tier: t, model: m, normalized: normalize(text), fired: new Set() })
    if (!hit) continue
    // 同一条规则（when.tier='any'）每档都会命中，只留第一次
    if (hits.some((h) => h.ruleId === hit.rule.id)) continue
    hits.push({ tier: t, ruleId: hit.rule.id, soft: hit.soft, why: hit.why })
  }
  const first = hits[0] || null
  return {
    matched: Boolean(first),
    ruleId: first ? first.ruleId : null,
    soft: first ? first.soft : false,
    why: first ? first.why : '',
    tier: explicit || (first ? first.tier : 'any'),
    tierExplicit: Boolean(explicit),
    tiersTried,
    hits,
  }
}

export function reflexState() {
  const file = rulesPath()
  const exists = existsSync(file)
  let broken = null
  let raw = null
  if (exists) {
    try { raw = JSON.parse(readFileSync(file, 'utf8')) } catch (e) { broken = String(e.message || e) }
  }
  const cfg = loadRules()
  const rules = cfg.rules.map((r) => ({
    id: r.id,
    priority: r.priority,
    oncePerSession: r.oncePerSession,
    tier: (r.when && r.when.tier) || 'any',
    text: (r.when && r.when.text) || '',
    model: (r.when && r.when.model) || '',
    reply: r.then.reply || '',
    directive: r.then.directive || '',
    extra: r.then.extra || '',
    nearAny: (r.when && r.when.nearAny) || [],
    keywords: (r.when && r.when.keywords) || [],
    minHits: (r.when && r.when.minHits) || 0,
    tools: (r.then && r.then.tools) || [],
  }))
  return {
    ok: true,
    file,
    fileExists: exists,
    broken,
    fileRuleCount: Array.isArray(raw && raw.rules) ? raw.rules.length : 0,
    fileEnabled: raw ? raw.enabled !== false : null,
    fileDryRun: raw ? raw.dryRun === true : null,
    enabled: cfg.enabled,
    dryRun: cfg.dryRun,
    rules,
    effective: cfg.enabled && rules.length > 0,
    shell: process.env.DSH_REFLEX_OFF === '1' ? 'off-by-env' : 'normal',
    log: logStats(path.join(configDir(), 'reflex.log.jsonl')),
    hint: '只读展示。要改：把「帮我加一条条件反射：<什么时候>→<怎么做>」交给你的 AI；改完让它跑 node scripts/reflex.mjs check（退出码 0 才算改完）。',
  }
}