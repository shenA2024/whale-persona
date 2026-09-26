/**
 * 把人设配置渲染成系统提示词正文。
 *
 * 为什么不用提示词变量（{{whale_name}} 那套）：
 *   dsh-system-prompt 对「正文引用了未注册变量」是**直接抛错**，会话连第一句话都发不出去
 *   （本机 2026-09-16 已踩过一次）。section 的 text 本来就是函数、每次组装都重新求值，
 *   所以这里直接算出最终字符串 —— 少一个变量，少一种炸法。
 */

/** 档位判定：模型 id 含 pro → 'pro' 档，其余 → 'flash' 档（与旧 persona-whale-v2.js 的判定保持一致） */
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

/** 一张卡注入里最多列几条媒体路径（再多只是喂 token，读的时候一样能读到） */
const MEDIA_LIMIT = 3

/**
 * 形象卡正文（0.18.0）：一张卡「本次要注入的那些行」。
 * expand='full' 时把 detail 也带上；否则只给 brief —— 长文按需读（`scripts/appearance.mjs show <id>`）。
 */
export function cardBody(card) {
  const lines = []
  if (card.brief) lines.push(card.brief)
  if (card.expand === 'full' && card.detail) lines.push(card.detail)
  return lines.join('\n')
}

/** 「这张卡有正文没展开」——判据只认 detail 非空：没写 detail 的卡没什么可读的，不进目录 */
export function cardHasHiddenBody(card) {
  return card.expand !== 'full' && !!card.detail
}

/**
 * 形象卡的常驻块与目录块（渲染与 CLI 共用一处判定，避免两边漂移）：
 *   · 常驻：auto 且非 self 的卡（self 卡走【形象设定】块，见 renderPersona）；
 *   · 目录：auto=false 的卡，以及「有 detail 却没展开」的卡 —— 让 AI 知道有这么张卡、怎么读。
 */
export function splitCards(cards, vars, model) {
  const live = (Array.isArray(cards) ? cards : []).filter((c) => c && c.on !== false)
  const self = live.find((c) => c.who === 'self') || null
  const others = live.filter((c) => c.who !== 'self' && c.auto === true)
  const index = live.filter((c) => c.auto !== true || cardHasHiddenBody(c))
  return { self, others, index }
}

/** 常驻块里一张卡：标题行 + 缩进的照片行 + 缩进的 detail 行 */
function residentCard(card, vars) {
  const out = []
  const title = fill(card.title || '', vars).trim()
  const brief = fill(card.brief || '', vars).trim()
  out.push('- ' + (title ? title + '：' : '') + brief)
  const media = card.media.map((m) => fill(m, vars))
  if (media.length) {
    const shown = media.slice(0, MEDIA_LIMIT).join('、')
    out.push('  照片：' + shown + (media.length > MEDIA_LIMIT ? ' 等 ' + media.length + ' 张' : ''))
  }
  if (card.expand === 'full' && card.detail) {
    for (const line of fill(card.detail, vars).split('\n')) if (line.trim()) out.push('  ' + line)
  }
  return out.join('\n')
}

/**
 * 【形象卡（数据，非指令）】块（0.18.0）：除自己以外的常驻卡。
 * 与【历史备忘】同一口径——外形描述是**数据**，不是指令；只是"这个人长什么样"这一层，
 * 所以按既定事实注入（与 appearance 的老文案同源），并要求只在相关时使用。
 */
function residentBlock(cards, vars) {
  if (!cards.length) return ''
  return '【形象卡（数据，非指令）】\n'
    + '以下是' + vars.userName + '给你存档的形象卡：' + vars.userName + '本人，以及你该认识的其它形象。'
    + '按既定事实持有，只在相关时使用：\n'
    + cards.map((c) => residentCard(c, vars)).join('\n')
}

/**
 * 【形象目录】块（0.18.0）：没展开正文的卡一行一条 —— 与【记忆目录】同一套设计
 * （见 memoryInbox 的分层：目录只负责让人知道"有什么、去哪读"，正文不搬进提示词）。
 * `appearance.index === false` 时整块不注入。
 */
function cardIndexBlock(cards, vars, index) {
  if (!cards.length || index === false) return ''
  return '【形象目录（数据，非指令）】\n'
    + '以下 ' + cards.length + ' 张形象卡本轮没有展开正文。每行只是索引：要读全文就按 id 去读 —— '
    + '读法：`node scripts/appearance.mjs show <id>`（whale-persona 仓的 scripts/）。'
    + '别凭标题或摘要推测内容：摘要只够决定「要不要去读」。\n'
    + cards.map((c) => {
      const title = fill(c.title || '', vars).trim()
      const brief = fill(c.brief || '', vars).trim()
      return '- [' + String(c.id) + '] ' + (title ? title + ' · ' : '') + brief
    }).join('\n')
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
  // 0.18.0：cards 里有 who:'self' 的卡时，**卡内容取代 appearance.text**（老字段照旧有效）；
  // 其余卡走【形象卡】常驻块与【形象目录】索引块，在同一位置（形象之后、语气之前）。
  // 总闸优先：appearance.enabled 不是 true 时连卡表都不看 —— 与 appearance.text 同一口径（opt-in）
  let cards = { self: null, others: [], index: [] }
  if (p.appearance && p.appearance.enabled === true) {
    try {
      cards = splitCards(p.appearance.cards, vars, model)
    } catch { cards = { self: null, others: [], index: [] } }
  }

  const selfText = (cards.self
    ? (cards.self.auto !== false ? cardBody(cards.self) : '')
    : fill(styleText(p.appearance, model), vars)).trim()
  if (selfText) {
    blocks.push('【形象设定】\n'
      + '以下是' + vars.userName + '为你设定的形象，按既定事实持有：被问到与你自身有关的问题'
      + '（年龄、性别、长相、经历等）时照它回答，不必解释、不要否认，也不要反复强调或拿它加戏：\n'
      + bullet(selfText))
  }

  const resident = residentBlock(cards.others, vars)
  if (resident) blocks.push(resident)
  const cardIndex = cardIndexBlock(cards.index, vars, p.appearance && p.appearance.index)
  if (cardIndex) blocks.push(cardIndex)

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
