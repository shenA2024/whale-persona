/**
 * 规则表读写：默认落在 $DSH_HOME/whale-persona/reflex.json（早期布局 $DSH_HOME/whale-suite/ 里已有
 * config.json 时沿用那个目录；可用 DSH_REFLEX_RULES 覆盖）。
 *
 * 为什么不塞进 config.json：config.json 是套件总配置（人设/工坊/toolscope 共用），
 * 反射规则是**会频繁手改的个人资产**，单独一个文件更好改、更好备份、更好整份分享。
 *
 * 读法沿用 core/lib/store.js 的纪律：**每次都读盘**（改完下一步即生效，不用新会话）；
 * 但这里加了体积上限与坏 JSON 容错——坏配置只让反射失效，绝不让会话发不出话。
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { configDir } from '../../../core/store.js'

const MAX_BYTES = 256 * 1024

/** 出厂默认：**零规则**（开源版装上零行为改变）；套件本地文件里才有真规则 */
export const EMPTY = { enabled: true, dryRun: false, rules: [] }

export function rulesPath() {
  const override = process.env.DSH_REFLEX_RULES
  if (override && String(override).trim()) return path.resolve(String(override).trim())
  return path.join(configDir(), 'reflex.json')
}

function sanitizeRules(arr) {
  if (!Array.isArray(arr)) return []
  const out = []
  for (const r of arr) {
    if (!r || typeof r !== 'object') continue
    const id = typeof r.id === 'string' && r.id.trim() ? r.id.trim() : null
    const then = r.then && typeof r.then === 'object' ? r.then : null
    if (!id || !then) continue
    const reply = typeof then.reply === 'string' ? then.reply : ''
    const directive = typeof then.directive === 'string' ? then.directive : ''
    if (!reply && !directive) continue // 没动作的规则是死规则，丢掉
    out.push({
      id,
      priority: Number(r.priority) || 0,
      oncePerSession: r.oncePerSession === true,
      when: r.when && typeof r.when === 'object' ? r.when : {},
      then: {
        reply,
        directive,
        extra: typeof then.extra === 'string' ? then.extra : '',
        // 步级工具裁剪的白名单：**必须透传**——漏了它，规则里写了 then.tools 也会被静默裁掉
        tools: Array.isArray(then.tools) ? then.tools.filter((n) => typeof n === 'string' && n.trim()) : [],
      },
    })
  }
  return out
}

export function loadRules() {
  if (process.env.DSH_REFLEX_OFF === '1') return { ...EMPTY, enabled: false, rules: [] }
  const file = rulesPath()
  try {
    if (statSync(file).size > MAX_BYTES) return { ...EMPTY, rules: [] }
    const raw = readFileSync(file, 'utf8')
    const cfg = JSON.parse(raw)
    return {
      enabled: cfg.enabled !== false,
      dryRun: cfg.dryRun === true,
      // 步级工具裁剪的总开关（默认关）：规则里还得显式写 then.tools，两道门都开才动工具表
      toolNarrowing: cfg.toolNarrowing === true,
      rules: sanitizeRules(cfg.rules),
      file,
    }
  } catch {
    return { ...EMPTY, rules: [], file }
  }
}

export function ensureFile() {
  const file = rulesPath()
  try {
    statSync(file)
  } catch {
    try {
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify(EMPTY, null, 2), 'utf8')
    } catch { /* 写不了就算了，内存默认值照样能用 */ }
  }
  return file
}
