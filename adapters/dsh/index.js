/**
 * whale-persona —— 多宿主人设引擎（DSH 宿主壳，无构建、纯 ESM）
 *
 * 它做一件事：把系统提示词的人设段变成**可开关、可自定义、可记忆**的产物。
 *   - 开：注入本插件渲染的人设（遮蔽部署级默认）
 *   - 关：返回空文本 —— 段消失，没有本插件人设
 *   - 绝不注销变量、绝不抛错：装配期任何异常都降级成空文本
 *
 * 与官方 @deepseek-ai/dsh-persona 的关系（2026-09-18 依第一方源码修正口径）：
 *   两者占同一个架构位——「preset 级 persona 遮蔽行」。挂载规则看层：
 *   跨层同名 = 遮蔽（官方替换机制，本插件在 agent preset 层遮蔽部署级默认）；
 *   同层同名 = 装配抛错（同一 preset 里已挂官方行就先卸掉它）；
 *   全局/profile 层挂载本插件 = 与注册表自身的 persona 注册同名冲突，当场 fail loud。
 *
 * 多宿主改造（2026-09-18）：渲染逻辑全部下沉到仓库根 core/（与 ZCode 适配器共享唯一源），
 * 本文件只剩「注册三个段 + 从 core 取文本」的宿主胶水。
 *
 * 生效时机：段是装配期注册、text 是每步求值 —— 改配置下一步生效，改挂载要新会话。
 */
import { createStore } from '../../core/store.js'
import { buildPersonaPrompt, buildSuffix, buildThinkingLanguage } from '../../core/prompt.js'

export const name = '@shenA2024/whale-persona'

/** 依赖 dsh-system-prompt 提供的 systemPrompt 服务 */
export const inject = ['systemPrompt']

/**
 * order 解析：优先问宿主的中心具名表（getSectionOrder，DSH 官方自用法），
 * 查不到或宿主无此 API 再回落常量——防上游调表后段静默错位（DSH 预告会有破坏性变更）。
 */
function resolveOrder(systemPrompt, key, fallback) {
  try {
    const n = systemPrompt && typeof systemPrompt.getSectionOrder === 'function'
      ? systemPrompt.getSectionOrder(key) : undefined
    return Number.isFinite(n) ? n : fallback
  } catch {
    return fallback
  }
}

/**
 * 思考语言段：无官方具名槽位，固定 order 20 插在人设段（0）与策略段（500）之间。
 * 段名用自有前缀 whale:（不占官方 deployment: 命名空间——具名表 34 键无此项）。
 */

export function apply(ctx) {
  const store = createStore()
  store.ensureFile()

  // 人设前缀/后缀占官方具名槽位（跨层遮蔽部署级默认）；思考语言段是自有槽位
  const ORDER_PERSONA_PREFIX = resolveOrder(ctx.systemPrompt, 'DEPLOYMENT_PERSONA_PREFIX', 0)
  const ORDER_PERSONA_SUFFIX = resolveOrder(ctx.systemPrompt, 'DEPLOYMENT_PERSONA_SUFFIX', 10200)
  const ORDER_THINKING_LANG = 20

  const disposePrefix = ctx.systemPrompt.section({
    name: 'deployment:persona-prefix',
    order: ORDER_PERSONA_PREFIX,
    // 正文由 core 渲染成品：关掉插值，既避免用户文本里的 {{}} 被误解析，也避免未知变量抛错
    interpolate: false,
    text: (context) => {
      try {
        const agent = context && context.agent
        const model = agent && agent.options && agent.options.model
        // cwd 给记忆相关性选择用（tag 命中当前项目目录的条目优先注入）
        const cwd = (agent && agent.session && agent.session.header && agent.session.header.cwd)
          || (agent && agent.session && agent.session.cwd)
          || (agent && agent.options && agent.options.cwd)
        return buildPersonaPrompt(store.get(), model, cwd)
      } catch {
        return ''
      }
    },
  })

  const disposeSuffix = ctx.systemPrompt.section({
    name: 'deployment:persona-suffix',
    order: ORDER_PERSONA_SUFFIX,
    // 不走 interpolate:true —— 用户自定义 suffix 里一个未知 {{var}} 就会让新会话发不出
    // 第一句话。{{cwd}} 由 core 自行替换，其余变量原样保留不触达插值器。
    interpolate: false,
    text: (context) => {
      try {
        const agent = context && context.agent
        const cwd = (agent && agent.session && agent.session.header && agent.session.header.cwd)
          || (agent && agent.session && agent.session.cwd)
          || (agent && agent.options && agent.options.cwd)
        return buildSuffix(store.get(), cwd)
      } catch {
        return ''
      }
    },
  })

  const disposeThinkingLang = ctx.systemPrompt.section({
    name: 'whale:thinking-language',
    order: ORDER_THINKING_LANG,
    interpolate: false,
    text: () => {
      try {
        return buildThinkingLanguage(store.get())
      } catch {
        return ''
      }
    },
  })

  return () => {
    disposePrefix()
    disposeSuffix()
    disposeThinkingLang()
  }
}
