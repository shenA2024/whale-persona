/**
 * 步级工具裁剪（P1）：命中规则后，把**这一步**看得见的工具裁到规则声明的白名单。
 *
 * 为什么它是这一层真正的差异化（证据，全部来自宿主源码）：
 *   · 工具定义占系统提示词 77%（35628/45971，toolscope 探针实测）——裁掉就是实打实省 token；
 *   · `agent.ctx.tools.restrict({allow})` 返回**解除函数**（dsh-tools/lib/index.js:2887-2907），所以是"本步裁、回合末放"；
 *   · 多层 restriction 是**交集**：`layers.every((l) => l.admits(name))` 才可见（同文件 :2971）——
 *     本包的白名单**盖不过** toolscope 的 deny，安全方向只会更紧；
 *   · PTC 模式下 `run_code` 始终可见，但程序内的嵌套调用只能调到 visible 的工具（同文件 :2977、:2999-3002）。
 *
 * 设计纪律（都是踩过或读源码得来的）：
 *   ① 只支持 **allow**（白名单）："我确信这活就这几样"；不支持 deny（"我以为用不上"会砸掉正事）；
 *   ② 名字先过滤：restrict 里出现一个未知名字就整体抛错 → `pickNarrow` 把不认识的挑出来，一个都不认识就**不裁**；
 *   ③ 默认关：规则要显式写 `then.tools`，且规则文件里 `"toolNarrowing": true` —— 两道门都开才动工具表；
 *   ④ 失败必须可见：指令里附一句"缺工具就说缺哪个"，台账记 restrict / restrict-skip。
 */

/** @returns {null | {allow: string[], unknown: string[], ok: boolean}} */
export function pickNarrow(rule, knownNames) {
  const then = (rule && rule.then) || {}
  const want = Array.isArray(then.tools) ? then.tools.filter((n) => typeof n === 'string' && n.trim()) : []
  if (want.length === 0) return null
  const known = knownNames instanceof Set ? knownNames : new Set(knownNames || [])
  const allow = want.filter((n) => known.has(n))
  const unknown = want.filter((n) => !known.has(n))
  if (allow.length === 0) return { allow: [], unknown, ok: false }
  return { allow, unknown, ok: true }
}

/** 裁剪生效时追加进指令的一句：让"裁错工具"变成看得见的失败，而不是哑掉 */
export const NARROW_NOTE = '这一步只允许用上面点名的工具；如果事情做不下去，用一句话说明缺哪个工具，不要绕路。'

/**
 * 量「这一步看得见的工具定义」有多少条、多少字符（裁剪前后各量一次 = 收益可算，而不是"感觉省了"）。
 * 走的是宿主同一个可见性解析器（`tools.view(agent)`，与"呈现/查找/派发"共用一份，dsh-tools/lib/index.js:2935-2983），
 * 所以它量到的就是模型真正看到的那一份。取不到就返回 null —— 测不了绝不假装测到了。
 */
export function measureTools(svc, agent) {
  try {
    if (!svc || typeof svc.view !== 'function') return null
    const view = svc.view(agent)
    const visible = view && view.visible
    if (!visible || typeof visible.entries !== 'function') return null
    let count = 0
    let chars = 0
    for (const [name, def] of visible.entries()) {
      count++
      try {
        const body = JSON.stringify(def, (k, v) => (typeof v === 'function' ? undefined : v))
        chars += String(name).length + (typeof body === 'string' ? body.length : 64)
      } catch { chars += String(name).length + 64 }
    }
    return { count, chars }
  } catch { return null }
}
