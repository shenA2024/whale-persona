/**
 * 段落注册的唯一实现 —— index.js（preset 平面）与 global.js（家目录 / profile 平面）共用。
 *
 * 两处唯一的差别是**段名与 order**：
 *   · preset 平面：必须占官方具名槽位 \`deployment:persona-prefix\` / \`-suffix\`（跨层遮蔽部署级默认）；
 *   · 家目录 / profile 平面：绝不能占那两个名字 —— 与宿主注册表同名 = 装配抛错、整棵树起不来
 *     （实测报错见 README「排错」），改用自有名 \`whale:persona-global\` 紧随其后。
 * 渲染、收口开关、/memory 命令的语义两处完全一致，都走 \`core/\`。
 */
import { createStore } from '../../core/store.js'
import { captureActive, runMemoryCommand } from '../../core/capture.js'
import { buildPersonaPrompt, buildThinkingLanguage } from '../../core/prompt.js'
// 末尾段走 core/measure.js 的 buildSuffixSection：用户 suffix + 可选「注入超预算」提醒行。
// 计量与渲染共用这一条通路，面板/CLI 的数字因此不会与真实注入脱钩（tests/inject-size.mjs 钉住）。
import { buildSuffixSection } from '../../core/measure.js'
// 记下宿主**真实**用的模型 id：界面显示名与它就常常不是一个东西（见 core/lastModel.js 头注）
import { recordModel } from '../../core/lastModel.js'

/**
 * order 解析：优先问宿主的中心具名表（getSectionOrder，DSH 官方自用法），
 * 查不到或宿主无此 API 再回落常量——防上游调表后段静默错位（DSH 预告会有破坏性变更）。
 */
function resolveOrder(systemPrompt, key, fallback) {
  if (!key) return fallback
  try {
    const n = systemPrompt && typeof systemPrompt.getSectionOrder === 'function'
      ? systemPrompt.getSectionOrder(key) : undefined
    return Number.isFinite(n) ? n : fallback
  } catch {
    return fallback
  }
}

/** 从段上下文里取 agent / model / cwd（两处注册共用的取法） */
function readContext(context) {
  const agent = context && context.agent
  const model = agent && agent.options && agent.options.model
  const cwd = (agent && agent.session && agent.session.header && agent.session.header.cwd)
    || (agent && agent.session && agent.session.cwd)
    || (agent && agent.options && agent.options.cwd)
  return { agent, model, cwd }
}

/**
 * 注册人设三段 + /memory 命令，返回 dispose。
 * @param ctx 宿主 ctx
 * @param names {{prefix:{name,orderKey,order},suffix:{name,orderKey,order},thinking:{name,order}}}
 */
export function registerPersonaSections(ctx, names) {
  const store = createStore()
  store.ensureFile()

  const ORDER_PREFIX = resolveOrder(ctx.systemPrompt, names.prefix.orderKey, names.prefix.order)
  const ORDER_SUFFIX = resolveOrder(ctx.systemPrompt, names.suffix.orderKey, names.suffix.order)

  const disposePrefix = ctx.systemPrompt.section({
    name: names.prefix.name,
    order: ORDER_PREFIX,
    // 正文由 core 渲染成品：关掉插值，既避免用户文本里的 {{}} 被误解析，也避免未知变量抛错
    interpolate: false,
    text: (context) => {
      try {
        const { agent, model, cwd } = readContext(context)
        const cfg = store.get()
        recordModel(model)
        // 【历史备忘】与【入库纪律】只在会话开关打开（或配置 capture:'always'）时注入
        return buildPersonaPrompt(cfg, model, cwd, { capture: captureActive(cfg, agent) })
      } catch {
        return ''
      }
    },
  })

  const disposeSuffix = ctx.systemPrompt.section({
    name: names.suffix.name,
    order: ORDER_SUFFIX,
    // 不走 interpolate:true —— 用户自定义 suffix 里一个未知 {{var}} 就会让新会话发不出
    // 第一句话。{{cwd}} 由 core 自行替换，其余变量原样保留不触达插值器。
    interpolate: false,
    text: (context) => {
      try {
        const { agent, model, cwd } = readContext(context)
        const cfg = store.get()
        return buildSuffixSection(cfg, model, cwd, captureActive(cfg, agent))
      } catch {
        return ''
      }
    },
  })

  const disposeThinkingLang = ctx.systemPrompt.section({
    name: names.thinking.name,
    order: names.thinking.order,
    interpolate: false,
    text: () => {
      try {
        return buildThinkingLanguage(store.get())
      } catch {
        return ''
      }
    },
  })

  /**
   * 会话内的「长期记忆收口」开关：/memory [on|off|status]
   * 命令跑在 UI 命令平面 —— 不产生模型消息、不占 token（dsh-commands 的约定）。
   * 用动态注入（ctx.inject）而不是静态 inject：拿不到 commands 服务时命令静默缺席，
   * 人设照常工作（静态 inject 不满足会让整个插件挂不上，人设直接消失）。
   */
  let registered = false
  let disposeFiber = null
  let disposeCommand = null
  const registerMemoryCommand = (commands) => {
    if (registered || !commands || typeof commands.register !== 'function') return
    registered = true
    disposeCommand = commands.register({
      name: 'memory',
      description: '长期记忆收口：开/关本会话的【入库纪律】注入（/memory on|off|status）',
      input: { hint: 'on | off | status' },
      handler: (invocation) => runMemoryCommand(invocation, store),
    })
  }
  try {
    // 先试同步取服务（命令当次挂载即可用）；取不到再退到动态注入
    if (typeof ctx.get === 'function') registerMemoryCommand(ctx.get('commands'))
  } catch { /* 服务还没就位 */ }
  if (!registered && typeof ctx.inject === 'function') {
    try {
      disposeFiber = ctx.inject(['commands'], (c) => {
        try { registerMemoryCommand(c.commands) } catch { disposeCommand = null }
      })
    } catch {
      disposeFiber = null
    }
  }

  return () => {
    try { if (typeof disposeCommand === 'function') disposeCommand() } catch { /* 已随 fiber 释放 */ }
    try { if (disposeFiber && typeof disposeFiber.dispose === 'function') disposeFiber.dispose() } catch { /* 无视 */ }
    disposePrefix()
    disposeSuffix()
    disposeThinkingLang()
  }
}

/** preset 平面的段名（占官方具名槽位；order 由宿主具名表解析） */
export const PRESET_SECTIONS = {
  prefix: { name: 'deployment:persona-prefix', orderKey: 'DEPLOYMENT_PERSONA_PREFIX', order: 0 },
  suffix: { name: 'deployment:persona-suffix', orderKey: 'DEPLOYMENT_PERSONA_SUFFIX', order: 10200 },
  thinking: { name: 'whale:thinking-language', order: 20 },
}

/**
 * 全局平面（家目录 / profile）的段名：**自有名**，不碰任何官方具名槽位。
 * 顺序紧随官方人设段之后（1 / 10201），思考语言段照旧排在两者之间（21）。
 */
export const GLOBAL_SECTIONS = {
  prefix: { name: 'whale:persona-global', order: 1 },
  suffix: { name: 'whale:persona-global-suffix', order: 10201 },
  thinking: { name: 'whale:global-thinking-language', order: 21 },
}
