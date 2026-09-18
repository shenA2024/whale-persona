/**
 * 默认配置（开源独立版：纯引擎、零观点，装上不改变任何行为——记忆流也默认关）。
 *
 * 用户自己在设置里填：自称、称呼、立场正文、工作契约、长期记忆（opt-in）。
 * shenA2024的个人人设（小助手/shenA2024/20 条契约）在他的私有 config.json 与预设文件里，
 * 与本默认值无关——这就是「通用默认 + 个人覆盖」两层配置。
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
    /** 自称（按模型分档：flash 档 / pro 档；只填一个时另一档回落它） */
    selfNameFlash: '我',
    selfNamePro: '我',
    /** 它怎么称呼你 */
    userName: '用户',
    /** 关系立场，可留空 */
    stance: '',
    /** 追加在提示词末尾的一句（支持 {{cwd}}，其余 {{var}} 原样保留不解析） */
    suffix: 'Your working directory is {{cwd}}.',
    /** 立场正文：可整段自定义，支持 {selfName} / {userName} 占位 */
    character: '',
    /** 工作契约：逐条可勾选启停，{selfName}/{userName} 占位可用 */
    contracts: [],
  },
  memory: {
    /** 默认关（opt-in）：开着会注入【入库纪律】块并改变收口行为，属于行为改变，须用户显式开启 */
    enabled: false,
    /** 手工条目（用户在 UI 里直接维护，权威层） */
    entries: [],
    /** 收件箱（AI 阶段收口提议 → 用户确认 → 只追加式入库，参考层） */
    inbox: true,
    /** 注入上限（收件箱，保新弃旧） */
    maxEntries: 30,
    /** 收件箱文件路径；空 = $DSH_HOME/whale-suite/memory-inbox.jsonl */
    inboxPath: '',
  },
}

/** 浅合并 + 数组整体替换：未知键透传（避免保存一次就把别的段裁掉） */
export function mergeConfig(user) {
  const u = user && typeof user === 'object' ? user : {}
  const p = u.persona && typeof u.persona === 'object' ? u.persona : {}
  const m = u.memory && typeof u.memory === 'object' ? u.memory : {}
  const d = DEFAULTS
  return {
    ...u,
    enabled: u.enabled !== undefined ? !!u.enabled : d.enabled,
    thinkingLanguage: u.thinkingLanguage === undefined ? d.thinkingLanguage : String(u.thinkingLanguage),
    persona: {
      enabled: p.enabled !== undefined ? !!p.enabled : d.persona.enabled,
      selfNameFlash: p.selfNameFlash || d.persona.selfNameFlash,
      selfNamePro: p.selfNamePro || d.persona.selfNamePro,
      userName: p.userName || d.persona.userName,
      stance: p.stance !== undefined ? p.stance : d.persona.stance,
      suffix: p.suffix !== undefined ? p.suffix : d.persona.suffix,
      character: p.character !== undefined ? p.character : d.persona.character,
      contracts: Array.isArray(p.contracts) ? p.contracts : d.persona.contracts,
    },
    memory: {
      enabled: m.enabled !== undefined ? !!m.enabled : d.memory.enabled,
      inbox: m.inbox !== undefined ? !!m.inbox : d.memory.inbox,
      maxEntries: Number(m.maxEntries) > 0 ? Number(m.maxEntries) : d.memory.maxEntries,
      inboxPath: typeof m.inboxPath === 'string' ? m.inboxPath : '',
      entries: Array.isArray(m.entries) ? m.entries : d.memory.entries,
    },
  }
}
