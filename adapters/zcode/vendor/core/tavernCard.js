/**
 * 酒馆（SillyTavern）角色卡 ↔ 本引擎预设 的映射层（0.10.0 新增）
 *
 * 为什么单独一层：角色卡是**别人的格式**，规范会演进；把它和我们的预设存储混在一起，
 * 将来改映射就会碰到存储。这里只做纯函数：进 = 卡对象 → 预设 + 映射报告；出 = 预设 → 卡对象。
 *
 * 我们**只承接"改系统提示词"的那部分**能力，映射表如实照下面写，承接不了的在报告里点名：
 *
 *   卡片字段（v2 data.*）          →  我们的字段
 *   name                          →  label / id
 *   creator                       →  author
 *   character_version             →  version
 *   tags                          →  tags
 *   description                   →  persona.character（主体）
 *   personality                   →  persona.stance（一句话性格 → 我们的"立场"）
 *   scenario                      →  persona.character 末尾追加（场景）
 *   system_prompt                 →  persona.contracts（按行拆成逐条契约）
 *   post_history_instructions     →  persona.suffix（都在上下文尾部）
 *   extensions.whale_persona      →  回填我们独有的字段（往返不丢）
 *   first_mes / alternate_greetings / mes_example / character_book / creator_notes
 *                                 →  **不承接**（开场白、示例对话、世界书需要宿主能力，不是人设段能干的），
 *                                    导入报告里列为 unmapped，绝不假装支持
 *
 * 注意：本层不读 PNG。酒馆卡常见的是"PNG 内嵌 JSON"，那种要先在酒馆里导出成 JSON。
 * 不做 PNG 的三个理由写进 README：解析不受信二进制、面板要开文件上传面、而收益只在一步导出。
 */

/**
 * 卡对象 → 安全 id（文件名）：非 ASCII 一律折成 '-'。
 * 中文卡名会被全部折掉 —— 那种情况用原名的短哈希兜底（djb2），
 * 否则所有中文卡都撞成同一个 id，第二张就把第一张覆盖了。
 */
export function slugId(name) {
  const raw = String(name == null ? '' : name).toLowerCase()
  const s = raw.replace(/[^a-z0-9_-]+/g, '-').replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '').slice(0, 40).replace(/[-_]+$/g, '')
  if (s) return s
  let h = 5381
  for (const ch of raw) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0
  return 'card-' + h.toString(36).slice(0, 6)
}

/** 认卡：'tavern-v2' | 'tavern-v1' | 'whale-preset' | 'unknown' */
export function detectCard(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'unknown'
  if (raw.persona && typeof raw.persona === 'object') return 'whale-preset'
  if (typeof raw.character === 'string' || Array.isArray(raw.contracts)) return 'whale-preset'
  const spec = String(raw.spec || '').toLowerCase()
  const d = raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data) ? raw.data : null
  if (spec === 'chara_card_v2' || spec === 'chara_card_v3' || (d && typeof d.description === 'string')) return 'tavern-v2'
  if (typeof raw.name === 'string' && (typeof raw.description === 'string' || typeof raw.first_mes === 'string')) return 'tavern-v1'
  return 'unknown'
}

const KNOWN_V2 = new Set([
  'name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'creator_notes',
  'system_prompt', 'post_history_instructions', 'alternate_greetings', 'character_book', 'tags',
  'creator', 'character_version', 'extensions', 'group_only_greetings', 'assets', 'nickname', 'creator_notes_multilingual',
])

/** 每行一条契约：剥掉列表符号与序号，去掉太短/太长的噪音行 */
function linesToContracts(text) {
  const out = []
  const seen = new Set()
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^(?:[-*•·]|\d+[.)、])\s*/, '').trim()
    if (line.length < 2 || line.length > 300) continue
    if (seen.has(line)) continue
    seen.add(line)
    out.push({ id: 'c' + (out.length + 1), text: line, on: true })
    if (out.length >= 40) break
  }
  return out
}

/**
 * 卡（对象或 JSON 文本）→ { preset, mapped, unmapped, notes }
 * 认不出来返回 null（调用方回一个可读的错误，不猜）。
 */
export function fromTavern(input) {
  let raw = input
  if (typeof input === 'string') {
    try { raw = JSON.parse(input) } catch { return null }
  }
  const kind = detectCard(raw)
  if (kind !== 'tavern-v2' && kind !== 'tavern-v1') return null
  const d = kind === 'tavern-v2' && raw.data && typeof raw.data === 'object' ? raw.data : raw
  const str = (v) => (typeof v === 'string' ? v.trim() : '')

  const notes = []
  const mapped = []
  const unmapped = []
  const take = (field, label) => { if (str(d[field])) { mapped.push(label); return str(d[field]) } return '' }

  const name = str(d.name) || 'imported-card'
  const description = take('description', 'description → 立场正文')
  const personality = take('personality', 'personality → 立场（一句话）')
  const scenario = take('scenario', 'scenario → 立场正文（追加）')
  const systemPrompt = take('system_prompt', 'system_prompt → 工作契约')
  const postHistory = take('post_history_instructions', 'post_history_instructions → 后缀')
  const tags = Array.isArray(d.tags) ? d.tags.map((t) => String(t)).filter(Boolean).slice(0, 32) : (d.tags ? [String(d.tags)] : [])
  if (tags.length) mapped.push('tags → 标签')

  for (const key of Object.keys(d)) {
    if (!KNOWN_V2.has(key) && !unmapped.includes(key)) unmapped.push('data.' + key)
  }
  for (const key of ['first_mes', 'alternate_greetings', 'mes_example', 'character_book', 'creator_notes', 'group_only_greetings', 'assets']) {
    if (d[key] !== undefined && d[key] !== null && !(Array.isArray(d[key]) && !d[key].length) && d[key] !== '') unmapped.push('data.' + key)
  }

  const persona = {}
  const characterParts = [description, scenario ? '【场景】\n' + scenario : ''].filter(Boolean)
  if (characterParts.length) persona.character = characterParts.join('\n\n')
  if (personality) persona.stance = personality
  const contracts = linesToContracts(systemPrompt)
  if (contracts.length) persona.contracts = contracts
  if (postHistory) persona.suffix = postHistory

  // 往返保真：我们自己导出的卡把独有字段放在 extensions.whale_persona
  const ext = d.extensions && typeof d.extensions === 'object' ? d.extensions.whale_persona : null
  let thinkingLanguage
  if (ext && typeof ext === 'object') {
    if (typeof ext.userName === 'string' && ext.userName) persona.userName = ext.userName
    if (typeof ext.selfNameFlash === 'string' && ext.selfNameFlash) persona.selfNameFlash = ext.selfNameFlash
    if (typeof ext.selfNamePro === 'string' && ext.selfNamePro) persona.selfNamePro = ext.selfNamePro
    if (ext.selfNameByModel && typeof ext.selfNameByModel === 'object') persona.selfNameByModel = ext.selfNameByModel
    if (ext.tone && typeof ext.tone === 'object') persona.tone = ext.tone
    if (ext.appearance && typeof ext.appearance === 'object') persona.appearance = ext.appearance
    if (typeof ext.stance === 'string' && ext.stance) persona.stance = ext.stance
    if (typeof ext.thinkingLanguage === 'string') thinkingLanguage = ext.thinkingLanguage
    mapped.push('extensions.whale_persona → 本引擎独有字段')
  }
  if (unmapped.length) {
    notes.push('以下字段本引擎**不承接**（需要宿主能力：开场白/示例对话/世界书）：' + unmapped.join('、'))
  }
  if (contracts.length >= 40) notes.push('system_prompt 行数过多，只截取了前 40 条契约。')
  notes.push('导入后**不会自动启用**：先在面板里看「此刻注入什么」的三段全文，再决定是否应用。')

  return {
    preset: {
      id: slugId(name),
      label: name,
      description: '导入自酒馆角色卡' + (str(d.character_version) ? '（卡版本 ' + str(d.character_version) + '）' : ''),
      author: str(d.creator),
      tags,
      thinkingLanguage,
      persona,
      source: { kind, name, creator: str(d.creator), characterVersion: str(d.character_version) },
    },
    mapped,
    unmapped,
    notes,
  }
}

/** 预设 → 酒馆 v2 卡（可被酒馆/其他支持该规范的客户端读；我们独有字段放 extensions 保往返） */
export function toTavern(preset) {
  const p = (preset && preset.persona) || {}
  const contracts = Array.isArray(p.contracts) ? p.contracts.filter((c) => c && c.text && c.on !== false) : []
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: String((preset && preset.label) || (preset && preset.id) || 'persona'),
      description: typeof p.character === 'string' ? p.character : '',
      personality: typeof p.stance === 'string' ? p.stance : '',
      scenario: '',
      first_mes: '',
      mes_example: '',
      creator_notes: '由 whale-persona 导出。本引擎只承接系统提示词部分：开场白/示例对话/世界书不在能力范围内；'
        + '独有字段（称呼、自称、语气、形象、思维链语言）保存在 extensions.whale_persona，导入回本引擎可原样还原。',
      system_prompt: contracts.map((c) => '- ' + String(c.text).trim()).join('\n'),
      post_history_instructions: typeof p.suffix === 'string' ? p.suffix : '',
      alternate_greetings: [],
      character_book: null,
      tags: Array.isArray(preset && preset.tags) ? preset.tags : [],
      creator: String((preset && preset.author) || 'whale-persona'),
      character_version: '1.0',
      extensions: {
        whale_persona: {
          spec: 'whale-persona-preset/1',
          userName: p.userName, selfNameFlash: p.selfNameFlash, selfNamePro: p.selfNamePro,
          selfNameByModel: p.selfNameByModel, stance: p.stance,
          tone: p.tone, appearance: p.appearance,
          thinkingLanguage: preset && preset.thinkingLanguage,
        },
      },
    },
  }
}

/** 认一下是不是本引擎的预设文件（导入时用来分流） */
export function looksLikeWhalePreset(raw) {
  return detectCard(raw) === 'whale-preset'
}
