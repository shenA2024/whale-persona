/**
 * @dsh-external/dsh-whale-persona —— 插件套件·人设引擎（DSH 宿主壳，无构建、纯 ESM）
 *
 * 它做一件事：把系统提示词的人设段变成**可开关、可自定义、可记忆**的产物。
 *   - 开：注入本插件渲染的人设（遮蔽部署级默认）
 *   - 关：返回空文本 —— 段消失，没有本插件人设
 *   - 绝不注销变量、绝不抛错：装配期任何异常都降级成空文本
 *
 * 为什么必须替换掉 @deepseek-ai/dsh-persona 那一行：
 *   段是按 name 注册的，同一作用域内重名会抛错；而 dsh-persona 的 prefix 是静态模板，
 *   做不到「按配置开关 / 按模型换称呼 / 运行时改」。所以本插件是它的**替代**，不是叠加。
 *
 * 多宿主改造（2026-09-18）：渲染逻辑全部下沉到仓库根 core/（与 ZCode 适配器共享唯一源），
 * 本文件只剩「注册三个段 + 从 core 取文本」的宿主胶水。
 *
 * 生效时机：段是装配期注册、text 是每步求值 —— 改配置下一步生效，改挂载要新会话。
 */
import { createStore } from '../../core/store.js'
import { buildPersonaPrompt, buildSuffix, buildThinkingLanguage } from '../../core/prompt.js'

export const name = '@dsh-external/dsh-whale-persona'

/** 依赖 dsh-system-prompt 提供的 systemPrompt 服务 */
export const inject = ['systemPrompt']

/** 第一方具名位置：人设前缀 0 / 后缀 10200（见 dsh-system-prompt 的 PromptSection 具名表） */
const ORDER_PERSONA_PREFIX = 0
const ORDER_PERSONA_SUFFIX = 10200

/** 思考语言段（order 20，插在人设段之后）。配置 thinkingLanguage：off（缺省）| zh-CN | en… */
const ORDER_THINKING_LANG = 20

export function apply(ctx) {
  const store = createStore()
  store.ensureFile()

  const disposePrefix = ctx.systemPrompt.section({
    name: 'deployment:persona-prefix',
    order: ORDER_PERSONA_PREFIX,
    // 正文由 core 渲染成品：关掉插值，既避免用户文本里的 {{}} 被误解析，也避免未知变量抛错
    interpolate: false,
    text: (context) => {
      try {
        const model = context && context.agent && context.agent.options && context.agent.options.model
        return buildPersonaPrompt(store.get(), model)
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
    name: 'deployment:thinking-language',
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
