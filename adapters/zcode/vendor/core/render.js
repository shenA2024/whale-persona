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
 * 按模型查表（2026-09-18 抽出：自称 / 形象 / 语气三处共用同一套匹配，避免三份实现各自漂移）
 *
 * 顺序（命中即返回）：
 *   ① **精确**键（忽略大小写）—— 例：{"Pro/zai-org/GLM-5.1": "小五"}
 *   ② **最长子串**命中 —— 键 "glm-5.1" 能命中 "Pro/zai-org/GLM-5.1"
 *   ③ 都没中 → null（回落由调用方决定：自称为两档，形象/语气为通用 text）
 * 为什么要子串那一步：模型 id 常带前缀（Pro/、供应商/），让用户每次照抄全名太苛刻。
 * 空键、空值、坏形状一律当没有 —— 最坏是「没命中」，不是抛错。
 */
export function pickByModel(table, model) {
  const t = table && typeof table === 'object' && !Array.isArray(table) ? table : null
  const want = typeof model === 'string' ? model.trim().toLowerCase() : ''
  if (!t || !want) return null
  let best = null
  for (const rawKey of Object.keys(t)) {
    const key = String(rawKey || '').trim().toLowerCase()
    const val = String(t[rawKey] == null ? '' : t[rawKey]).trim()
    if (!key || !val) continue
    if (key === want) return val
    if (want.indexOf(key) >= 0 && (!best || key.length > best.key.length)) best = { key, val }
  }
  return best ? best.val : null
}

/** 自称解析：按模型命中优先，都没中才回落 pro / flash 两档 */
export function selfNameOf(cfg, tier, model) {
  const p = (cfg && cfg.persona) || {}
  const hit = pickByModel(p.selfNameByModel, model)
  if (hit) return hit
  return tier === 'pro' ? (p.selfNamePro || p.selfNameFlash) : p.selfNameFlash
}

/**
 * 形象 / 语气的取值（2026-09-18 新增）：
 * 开关 false 或字段缺失 → 空（opt-in，默认关）；按模型命中 → 用它；否则用通用 text。
 */
export function styleText(field, model) {
  if (!field || typeof field !== 'object' || Array.isArray(field)) return ''
  if (field.enabled !== true) return ''
  const hit = pickByModel(field.byModel, model)
  if (hit) return hit
  return String(field.text == null ? '' : field.text).trim()
}

/** 多行文本按行加 '- '（空行保持空行，不留孤零零的一个破折号） */
function bullet(text) {
  return String(text).split('\n').map((line) => (line.trim() ? '- ' + line : '')).join('\n')
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

  // 形象与语气（0.9.0）：opt-in + 按模型覆盖，位置在「立场正文」之后、「工作契约」之前 ——
  // 它们是「你是谁」的补充，契约是硬约束，硬约束永远排最后。
  const appearance = fill(styleText(p.appearance, model), vars).trim()
  if (appearance) {
    blocks.push('【形象设定】\n'
      + '以下是' + vars.userName + '为你设定的形象，按既定事实持有：被问到与你自身有关的问题'
      + '（年龄、性别、长相、经历等）时照它回答，不必解释、不要否认，也不要反复强调或拿它加戏：\n'
      + bullet(appearance))
  }

  const tone = fill(styleText(p.tone, model), vars).trim()
  if (tone) {
    blocks.push('【回复语气】\n'
      + '以下是' + vars.userName + '要求的措辞与节奏：只改变你怎么说话，不改变结论、证据标准与工作契约：\n'
      + bullet(tone))
  }

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
