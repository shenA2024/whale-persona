/**
 * 把人设配置渲染成系统提示词正文。
 *
 * 为什么不用提示词变量（{{whale_name}} 那套）：
 *   dsh-system-prompt 对「正文引用了未注册变量」是**直接抛错**，会话连第一句话都发不出去
 *   （本机 2026-09-16 已踩过一次）。section 的 text 本来就是函数、每次组装都重新求值，
 *   所以这里直接算出最终字符串 —— 少一个变量，少一种炸法。
 */

/** flash → 姐姐 / pro → 妈妈（与旧 persona-whale-v2.js 的判定保持一致） */
export function tierOf(model) {
  if (typeof model !== 'string') return 'flash'
  if (/pro/i.test(model)) return 'pro'
  return 'flash'
}

/**
 * 自称解析（2026-09-18 扩展：任何模型都能单独指定，不再只有两档）
 *
 * 顺序（命中即返回）：
 *   ① persona.selfNameByModel 里的**精确**键（忽略大小写）—— 例：{"Pro/zai-org/GLM-5.1": "小五"}
 *   ② 同一张表里的**最长子串**命中 —— 键 "glm-5.1" 能命中 "Pro/zai-org/GLM-5.1"
 *   ③ 回落两档：pro 档 selfNamePro（为空则 selfNameFlash）/ 否则 selfNameFlash
 * 为什么要子串那一步：模型 id 常带前缀（Pro/、供应商/），让用户每次照抄全名太苛刻。
 */
export function selfNameOf(cfg, tier, model) {
  const p = (cfg && cfg.persona) || {}
  const table = p.selfNameByModel && typeof p.selfNameByModel === 'object' && !Array.isArray(p.selfNameByModel)
    ? p.selfNameByModel : null
  const want = typeof model === 'string' ? model.trim().toLowerCase() : ''
  if (table && want) {
    let best = null
    for (const rawKey of Object.keys(table)) {
      const key = String(rawKey || '').trim().toLowerCase()
      const val = String(table[rawKey] == null ? '' : table[rawKey]).trim()
      if (!key || !val) continue
      if (key === want) return val
      if (want.indexOf(key) >= 0 && (!best || key.length > best.key.length)) best = { key, val }
    }
    if (best) return best.val
  }
  return tier === 'pro' ? (p.selfNamePro || p.selfNameFlash) : p.selfNameFlash
}

function fill(text, vars) {
  return String(text).replace(/\{selfName\}/g, vars.selfName).replace(/\{userName\}/g, vars.userName)
}

export function renderPersona(cfg, tier, model) {
  if (!cfg || cfg.enabled === false) return ''
  const p = cfg.persona
  if (!p || p.enabled === false) return ''

  const vars = { selfName: selfNameOf(cfg, tier, model), userName: p.userName }
  const blocks = []

  // stance = 一句话关系立场，character = 整段立场正文：两个都在就渲染两块，只填一个也成立
  const stance = fill(p.stance || '', vars).trim()
  if (stance) blocks.push(stance)

  const character = fill(p.character || '', vars).trim()
  if (character) blocks.push(character)

  const contractLines = (p.contracts || [])
    .filter((c) => c && c.on !== false && c.text)
    .map((c) => '- ' + fill(c.text, vars).trim())
  if (contractLines.length) blocks.push('工作契约：\n' + contractLines.join('\n'))

  const memories = ((cfg.memory && cfg.memory.entries) || [])
    .filter((m) => m && m.on !== false && m.text)
    .map((m) => '- ' + fill(m.text, vars).trim())
  if (cfg.memory && cfg.memory.enabled !== false && memories.length) {
    blocks.push('长期记忆（' + vars.userName + '明确要求你记住的）：\n' + memories.join('\n'))
  }

  return blocks.join('\n\n')
}
