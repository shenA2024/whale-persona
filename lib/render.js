/**
 * 把人设配置渲染成系统提示词正文。
 *
 * 为什么不用提示词变量（{{whale_name}} 那套）：
 *   dsh-system-prompt 对「正文引用了未注册变量」是**直接抛错**，会话连第一句话都发不出去
 *   （本机 2026-09-16 已踩过一次）。section 的 text 本来就是函数、每次组装都重新求值，
 *   所以这里直接算出最终字符串 —— 少一个变量，少一种炸法。
 */

/** flash → <relationship> / pro → <relationship>（与旧 persona-whale-v2.js 的判定保持一致） */
export function tierOf(model) {
  if (typeof model !== 'string') return 'flash'
  if (/pro/i.test(model)) return 'pro'
  return 'flash'
}

export function selfNameOf(cfg, tier) {
  const p = cfg.persona
  return tier === 'pro' ? (p.selfNamePro || p.selfNameFlash) : p.selfNameFlash
}

function fill(text, vars) {
  return String(text).replace(/\{selfName\}/g, vars.selfName).replace(/\{userName\}/g, vars.userName)
}

export function renderPersona(cfg, tier) {
  if (!cfg || cfg.enabled === false) return ''
  const p = cfg.persona
  if (!p || p.enabled === false) return ''

  const vars = { selfName: selfNameOf(cfg, tier), userName: p.userName }
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
