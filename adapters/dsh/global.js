/**
 * whale-persona · **全局入口**（0.9.2 新增）——让所有模式/所有 profile 都带上人设。
 *
 * 为什么需要单独一个入口：人设段只有两种挂法，段名决定了能挂哪一层。
 *   · {@link ./index.js} 占官方具名槽位 \`deployment:persona-prefix\`，只能挂 **agent preset 平面**
 *     —— 好处是「跨层遮蔽」部署级默认，坏处是**只有用那份 preset 的会话有人设**：
 *     新建会话时选了官方「标准模式 / PTC」，那个会话就是官方人设；
 *   · 本入口用**自有段名** \`whale:persona-global\`，可以挂 **家目录层**
 *     （\`$DSH_HOME/cordis.patch.yml\`，一次覆盖 web / tui / headless）或某个 profile 的 patch 栈，
 *     于是**每一个会话**都拿得到人设——代价是它不遮蔽官方人设（见下）。
 *
 * 代价与前置条件（README「全局模式」一节有全文）：
 *   ① 官方人设段的正文还在。若你的部署在 \`system-prompt\` 里配了 personaPrefix，
 *      系统提示词里会**两份人设并存** —— 全局模式下应当把它置空：
 *      \`- id: system-prompt\` / \`config: { personaPrefix: '' }\`（本机 2026-09-18 起就是这么配的）；
 *   ② 全局模式覆盖的是**整个 profile**（家目录层＝所有 profile），子代理也跟着父会话拿同一份人设；
 *   ③ 两种入口**不要同时挂**：同一份人设会注入两遍。
 *
 * 挂法（二选一）：
 *   家目录层  \`$DSH_HOME/cordis.patch.yml\`：
 *     - insert:
 *         - id: whale-persona-global
 *           name: 'whale-persona/global'
 *   单 profile 层  \`$DSH_HOME/profiles/<p>/cordis.patch.yml\`：同上。
 */
import { registerPersonaSections, GLOBAL_SECTIONS } from './sections.js'

export const name = 'whale-persona/global'

/** 依赖 dsh-system-prompt 提供的 systemPrompt 服务 */
export const inject = ['systemPrompt']

export function apply(ctx) {
  return registerPersonaSections(ctx, GLOBAL_SECTIONS)
}
