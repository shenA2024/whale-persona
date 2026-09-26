/**
 * 默认配置（开源独立版：纯引擎、零观点，装上不改变任何行为——记忆流也默认关）。
 *
 * 用户自己在配置里填：自称、称呼、立场正文、工作契约、长期记忆（opt-in）。
 * 个人人设属于用户自己的 config.json（以及他的预设文件），与本默认值无关 ——
 * 这就是「通用默认 + 个人覆盖」两层配置。
 */

export const DEFAULTS = {
  enabled: true,
  /**
   * 思维链语言：'off'（默认，不干预，跟随模型）| 'zh-CN' | 'en' | ...
   * 说明：它只影响①思考面板的可读性②token 开销（中文略省）③细微的推理风格差异
   * （前沿模型双语差异很小）。开源默认不干预，避免给非中文用户添乱。
   */
  thinkingLanguage: 'off',
  persona: {
    enabled: true,
    /** 当前应用的人设预设 id（供外部配置界面写入；纯引擎用户留空即可） */
    preset: '',
    /** 自称（按模型分档：flash 档 / pro 档；只填一个时另一档回落它） */
    selfNameFlash: '我',
    selfNamePro: '我',
    /**
     * 按具体模型指定自称：{ "模型 id 或其中一段": "自称" }，如 {"grok-4.7": "小七", "GLM-5.1": "小五"}。
     * 匹配：先精确（忽略大小写），再最长子串；都没命中才回落到上面的两档。空表 = 只用两档。
     */
    selfNameByModel: {},
    /** 它怎么称呼你 */
    userName: '用户',
    /** 关系立场（一句话即可，渲染在 character 之前），支持 {selfName}/{userName} */
    stance: '',
    /** 追加在提示词末尾的一句（支持 {{cwd}}，其余 {{var}} 原样保留不解析）；默认空 = 装上零行为改变，想要工作目录提示自己加 */
    suffix: '',
    /** 立场正文：可整段自定义，支持 {selfName} / {userName} 占位 */
    character: '',
    /**
     * 形象（opt-in，默认关）：把「你是谁／长什么样」当成关于你自己的既定事实注入，如
     * 「你是一位 20 岁的女性，身高 1.75 m」。
     * 结构 = { enabled, text（所有模型通用的默认）, byModel（按模型覆盖，命中优先） ,
     *          cards（0.17.0：形象卡，见下）, index（是否渲染【形象目录】） }。
     * 匹配规则与 selfNameByModel 完全一致（精确 → 最长子串 → 回落 text）。
     * 默认关 + 默认空 + 卡表空 = 装上零行为改变（与 memory 同一口径）。
     */
    appearance: { enabled: false, text: '', byModel: {}, cards: [], index: true },
    /**
     * 语气（opt-in，默认关）：只改**措辞与节奏**，不改结论、证据标准与工作契约。
     * 结构与 appearance 相同：{ enabled, text, byModel }。
     */
    tone: { enabled: false, text: '', byModel: {} },
    /** 工作契约：逐条可勾选启停，{selfName}/{userName} 占位可用 */
    contracts: [],
  },
  /**
   * 注入体积预算（0.13.0）：只**计量与提醒**，永不自动裁剪。
   * enabled=false（默认）时连提醒行都不注入 —— 装上零行为改变（与 memory / appearance 同一口径）。
   * max = 预算上限（字符，按人设前缀 + 后缀 + 思考语言段的注入长度合计）。
   */
  budget: { enabled: false, max: 0, warnInPrompt: true },
  memory: {
    /** 默认关（opt-in）：开着会注入【入库纪律】块并改变收口行为，属于行为改变，须用户显式开启 */
    enabled: false,
    /** 手工条目（用户在 UI 里直接维护，权威层） */
    entries: [],
    /** 收件箱（AI 阶段收口提议 → 用户确认 → 只追加式入库；[更新]/[删去]以 supersede/drop 操作行落地，参考层） */
    inbox: true,
    /**
     * 收口模式：'on-demand'（默认）—— 会话内 /memory on 才注入收件箱与入库纪律；
     * 'always' —— 旧行为，每轮都注入。手工条目不受它控制。
     */
    capture: 'on-demand',
    /** 注入上限（收件箱；core 不受它约束，hot 按当前项目 tag 相关性竞争，超出保新弃旧） */
    maxEntries: 30,
    /**
     * 【记忆目录】（0.17.0）：把未展开的条目（tier=cold + 超额 hot）渲染成一行一条的索引块，
     * 让 AI 知道「有哪些记忆不在眼前、该去哪读」，而不是对它们一无所知。
     * 默认 true —— 只有「未展开」的条目会出现在目录里：tier=cold 的，以及竞争落选的（含**未写 tier** 的老条目，
     * 它们走竞争池、不再静默消失）；一个这样的条目都没有时目录块不注入，逐字节零行为改变。设 false = 完全不注入目录。
     */
    index: true,
    /** 收件箱文件路径；空 = 配置目录下的 memory-inbox.jsonl（见 store.js 的 configDir()） */
    inboxPath: '',
    /**
     * 沉降路由（0.13.0）：把「AI 提议 → 人确认」的闸门推广到人设记忆之外的条目。
     * 形态 { "<kind>": { path, format?, template?, header?, createParents? } }：
     *   · kind 为 'memory'（缺省）的条目照旧**注入提示词**，不落盘；
     *   · 其余 kind（如 pitfall / idea / placement）确认后按路由**只追加式**写进 path。
     * 默认空表 = 零行为改变（没有路由的 kind 确认后只是"确认了但没有去处"，会显式报出来）。
     */
    sinks: {},
    /** 沉降日志（幂等判据 + 审计）；空 = 配置目录下的 sink-log.jsonl */
    sinkLog: '',
    /**
     * 候选确认闸门（0.8.0 起默认 **true**，代码强制而非提示词约束）：
     * 开启时注入只认 status:"confirmed"（人工用 memory.mjs / 面板确认过的）条目；
     * AI 写的 status:"proposed" 候选永不注入，老格式（无 status）条目也不注入（避免"AI 直接追加即生效"）。
     * 设为 false = 放行老格式条目（0.8.0 之前的文件照旧注入），但 proposed 候选仍然不注入。
     */
    requireConfirm: true,
  },
}

/** 形象卡的归属：自己 / 用户本人 / 其它（第三方角色、同事、宠物…） */
export const CARD_WHO = ['self', 'user', 'other']

/**
 * 「开关 + 通用文本 + 按模型覆盖表」这一族字段的归一化（tone 用；appearance 见 appearanceField）。
 * 未知子键原样透传（与整体纪律一致：保存一次不许把别人的键裁掉），坏形状一律回落默认。
 */
function styleField(user, def) {
  const u = user && typeof user === 'object' && !Array.isArray(user) ? user : {}
  return {
    ...u,
    enabled: u.enabled !== undefined ? !!u.enabled : def.enabled,
    text: u.text !== undefined ? String(u.text) : def.text,
    byModel: (u.byModel && typeof u.byModel === 'object' && !Array.isArray(u.byModel)) ? u.byModel : def.byModel,
  }
}

/**
 * 单张形象卡归一化（0.17.0）。返回 null = 这张卡整张丢掉：
 *   · 形状不是对象；· title / brief / detail 全空（空条目只会在注入里占一行噪音）。
 * 默认值按「谁」推：auto 默认 self/user 常驻、other 不常驻；expand 默认 self 展开全文、其余只展开一行。
 * `{...c}` 在前 —— 未知子键原样透传（同 §2.6 纪律）。
 */
function normCard(raw, i) {
  const c = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null
  if (!c) return null
  const title = String(c.title == null ? '' : c.title).trim()
  const brief = String(c.brief == null ? '' : c.brief).trim()
  const detail = String(c.detail == null ? '' : c.detail).trim()
  if (!title && !brief && !detail) return null
  const who = CARD_WHO.includes(c.who) ? c.who : 'other'
  const id = String(c.id == null ? '' : c.id).trim() || ('card-' + (i + 1))
  const media = Array.isArray(c.media)
    ? c.media.map((m) => String(m == null ? '' : m).trim()).filter(Boolean)
    : []
  const defAuto = who === 'self' || who === 'user'
  const auto = c.auto !== undefined ? !!c.auto : defAuto
  const expand = (c.expand === 'full' || c.expand === 'brief') ? c.expand : (who === 'self' ? 'full' : 'brief')
  return { ...c, id, who, title, brief, detail, media, auto, expand, on: c.on !== false }
}

/** 卡表归一化：丢空卡；**id 重复只留第一张**（可预测优先于报错，CLI 与渲染都按 id 定位） */
export function normCards(list) {
  const arr = Array.isArray(list) ? list : []
  const seen = new Set()
  const out = []
  for (let i = 0; i < arr.length; i++) {
    const c = normCard(arr[i], i)
    if (!c) continue
    if (seen.has(c.id)) continue
    seen.add(c.id)
    out.push(c)
  }
  return out
}

/** appearance 归一化：比 styleField 多 cards / index 两个子键 */
function appearanceField(user, def) {
  const base = styleField(user, def)
  const u = user && typeof user === 'object' && !Array.isArray(user) ? user : {}
  return {
    ...base,
    cards: normCards(u.cards),
    index: u.index !== undefined ? !!u.index : def.index,
  }
}

/** 浅合并 + 数组整体替换：未知键透传（避免保存一次就把别的段裁掉） */
export function mergeConfig(user) {
  const u = user && typeof user === 'object' ? user : {}
  const p = u.persona && typeof u.persona === 'object' ? u.persona : {}
  const m = u.memory && typeof u.memory === 'object' ? u.memory : {}
  const b = u.budget && typeof u.budget === 'object' && !Array.isArray(u.budget) ? u.budget : {}
  const d = DEFAULTS
  return {
    ...u,
    enabled: u.enabled !== undefined ? !!u.enabled : d.enabled,
    thinkingLanguage: u.thinkingLanguage === undefined ? d.thinkingLanguage : String(u.thinkingLanguage),
    persona: {
      enabled: p.enabled !== undefined ? !!p.enabled : d.persona.enabled,
      preset: p.preset !== undefined ? p.preset : d.persona.preset,
      selfNameFlash: p.selfNameFlash || d.persona.selfNameFlash,
      selfNamePro: p.selfNamePro || d.persona.selfNamePro,
      selfNameByModel: (p.selfNameByModel && typeof p.selfNameByModel === 'object' && !Array.isArray(p.selfNameByModel))
        ? p.selfNameByModel : d.persona.selfNameByModel,
      userName: p.userName || d.persona.userName,
      stance: p.stance !== undefined ? p.stance : d.persona.stance,
      suffix: p.suffix !== undefined ? p.suffix : d.persona.suffix,
      character: p.character !== undefined ? p.character : d.persona.character,
      appearance: appearanceField(p.appearance, d.persona.appearance),
      tone: styleField(p.tone, d.persona.tone),
      contracts: Array.isArray(p.contracts) ? p.contracts : d.persona.contracts,
    },
    budget: {
      enabled: b.enabled !== undefined ? !!b.enabled : d.budget.enabled,
      max: Number(b.max) > 0 ? Number(b.max) : d.budget.max,
      warnInPrompt: b.warnInPrompt !== undefined ? !!b.warnInPrompt : d.budget.warnInPrompt,
    },
    memory: {
      enabled: m.enabled !== undefined ? !!m.enabled : d.memory.enabled,
      inbox: m.inbox !== undefined ? !!m.inbox : d.memory.inbox,
      capture: typeof m.capture === 'string' ? m.capture : d.memory.capture,
      maxEntries: Number(m.maxEntries) > 0 ? Number(m.maxEntries) : d.memory.maxEntries,
      index: m.index !== undefined ? !!m.index : d.memory.index,
      inboxPath: typeof m.inboxPath === 'string' ? m.inboxPath : '',
      entries: Array.isArray(m.entries) ? m.entries : d.memory.entries,
      sinks: (m.sinks && typeof m.sinks === 'object' && !Array.isArray(m.sinks)) ? m.sinks : d.memory.sinks,
      sinkLog: typeof m.sinkLog === 'string' ? m.sinkLog : '',
      requireConfirm: m.requireConfirm !== undefined ? !!m.requireConfirm : d.memory.requireConfirm,
    },
  }
}
