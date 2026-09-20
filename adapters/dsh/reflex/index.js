/**
 * 人设引擎 · 条件反射层（reflex）—— 用户自定义规则，命中即注入一步指令（纯规则，0 模型调用）
 *
 * 触发来源：2026-09-20 用户需求：自己设条件反射、用代码匹配降低 token 消耗（对应 Jev 那类模型层反射的插件层做法）。
 * 背景（证据）：Jev（TypeSafe AI / Diogo Almeida）是**模型层**的反射——不生成文本、只输出结构化决策；
 *   我们做的是**插件层**的反射：命中即动作，匹配不花 token。两者不冲突，也别互相冒充。
 *
 * 机制：在 `agent/pre-step`（waterfall，能改进入这一步的消息）里，用**纯代码**比对
 *   模型档位（flash/pro）+ 原话正则，命中则追加一条极短指令，让模型**当步直答**。
 *
 * 边界（诚实声明，别当 0 生成）：宿主的 PreStepDecision 只有 `reject` / `enter(messages)`
 *   （dsh-agent/lib/types/runtime-types.d.ts:92-99），**没有"直接产出助手回答并结束回合"的出口**。
 *   所以本包给的是「一步极短回答」（省掉查工具、省掉长篇输出），不是「零生成」。
 *   哪天宿主开了短路出口，改 buildDirective 的调用点即可，规则格式不用动。
 *
 * 纪律：
 *   ① 规则是**个人资产**：只落本地 `$DSH_HOME/whale-persona/reflex.json`（早期布局 `$DSH_HOME/whale-suite/`
 *      存在 config.json 时沿用那个目录），仓库里只有空的出厂默认；
 *   ② 任何异常都不许影响会话——读不了、写不了、正则有错，一律放行；
 *   ③ dry-run 优先：只记账不动作；
 *   ④ 命中留痕：每次 fire/dry-run 写一行 JSONL，回答"刚才为什么那样"。
 */
import path from 'node:path'
import { configDir } from '../../../core/store.js'
import { makeJsonlLog } from './log.js'
import { loadRules, ensureFile, rulesPath } from './rules.js'
import { matchRule, tierOf, userTexts, normalize } from './match.js'
import { reflexState, reflexTest } from './state.js'
import { pickNarrow, NARROW_NOTE, measureTools } from './toolnarrow.js'
import { randomUUID } from 'node:crypto'

/**
 * 造一条"插件注入的用户消息"—— **本仓零宿主依赖策略**，所以不 import 宿主的 createUserMessage，
 * 自己按宿主校验器要求造（形状错了会让整个会话历史加载不出来，所以这三件事一个都不能少）：
 *   ① `id` 非空字符串；② `role: 'user'`；③ `source` 是对象且 `kind` 非空（写成字符串会把会话读坏）。
 * 依据：宿主会话校验器对 user/message 的判据（id / role / source.kind / content 数组）。
 */
function makeUserMessage({ content, source }) {
  return Object.freeze({ id: randomUUID(), role: 'user', content, source })
}


const SOURCE = 'whale-persona-reflex'

/**
 * 轮 1（2026-09-20，触发来源：用户的目标不是 0 token，而是更快回答——别用一大坨 token 去搜记忆）：
 * 2026-09-20 二次修订（用户拍板）：**只对硬命中（text / nearAny）瘦身**；
 *   软命中（词袋）只注入指令、额度与 effort 一概不动 —— 软命中可能整条不成立，
 *   模型会去答真正的问题，压额度等于截断正常回答（台账实测：误触发的那一步被压成 200）。
 * 命中反射后的**那一步**，把模型请求降成「最便宜的形态」——
 *   ① maxTokens 压到 REFLEX_MAX_TOKENS（输出只留一句）
 *   ② reasoningEffort 降到该模型**确实声明**的最低档（不在声明里就一概不动，防 400）
 * 为什么走 agent/request：它是官方 waterfall，返回 LlmCallConfig（provider/model/effort/maxTokens，
 * 不含 tools/system——所以砍不了工具表，那事另开一轮实验）。
 * 边界：这是「更便宜地问模型」，不是「不问模型」；宿主没有直接出答案的出口（PreStepDecision 只有 reject/enter）。
 */
const REFLEX_MAX_TOKENS = 200
/** 命中后多久内的 request 算「这一步」（秒级即可，防串到下一轮） */
const REFLEX_WINDOW_MS = 30000
const pendingReflex = new Map()
const effortCache = new Map()

/** 只认确定是"最低档"的名字；拿不准就返回 null —— 宁可不降，也不发一个模型没声明的档位 */
function pickLowestEffort(efforts) {
  const want = ['off', 'none', 'minimal', 'low']
  for (const w of want) {
    const hit = (efforts || []).find((e) => String(e && e.id).toLowerCase() === w)
    if (hit) return hit.id
  }
  return null
}

/**
 * 这个模型声明了哪些推理档位、能不能降到最低。
 * 为什么要知道"有没有推理档位"（2026-09-20 实测踩到）：**输出额度是推理和正文共用的** ——
 * 模型只会 high 时，压到 200 token 会被推理先吃掉，正文被截断（界面显示"已达到输出 token 上限"）。
 * 所以「压额度」只在**压得动推理**（能把 effort 降到 off/低档）或**根本没有推理**时才安全。
 */
async function modelEffortInfo(ctx, cfg) {
  const key = cfg.provider + '|' + cfg.model
  if (effortCache.has(key)) return effortCache.get(key)
  let out = { low: null, hasReasoning: false }
  try {
    const llm = ctx.get && ctx.get('llm')
    if (llm && typeof llm.listModels === 'function') {
      const models = await llm.listModels(cfg.provider)
      const info = (models || []).find((m) => m && (m.id === cfg.model || m.model === cfg.model || m.name === cfg.model))
      const rea = info && (info.reasoning || info)
      const efforts = (rea && rea.efforts) || []
      out = { low: pickLowestEffort(efforts), hasReasoning: efforts.length > 0 }
    }
  } catch { out = { low: null, hasReasoning: false } }
  // 只缓存**有意义**的结果：查到推理档位才缓存，空结果不缓存（否则一次查询失败会把结论永久钉住，smoke T12→T14 实测）
  if (out.hasReasoning) effortCache.set(key, out)
  return out
}
/** 每会话每规则是否已触发（oncePerSession 用）；上限防长跑会话内存无界 */
const fired = new Map()

/**
 * 步级工具裁剪的现场（sessionId → 解除函数）。
 * 语义是「一步一裁」：本步裁，**下一步开头解除** —— 所以一次误命中不会把工具藏一整场会话。
 */
const narrows = new Map()

function liftNarrow(sessionId) {
  const cur = narrows.get(sessionId)
  if (!cur) return
  narrows.delete(sessionId)
  try { cur.lift() } catch { /* 解除失败最坏是不省 token；restriction 是交集，不会因此放开别的限制 */ }
}

function toolService(agent) {
  const t = agent && agent.ctx && agent.ctx.tools
  return t && typeof t.restrict === 'function' ? t : null
}

function isKnownTool(agent, name) {
  const svc = toolService(agent)
  if (!svc || typeof svc.get !== 'function') return false
  try { return svc.get(name, agent) !== undefined } catch { return false }
}

/**
 * 算出这一步的裁剪方案（不真裁）。返回 null = 不动工具表。
 * 注意 `run_code` 是宿主保留的 PTC 传输名，restrict 里点名它会抛错 —— 直接当"不认识的工具"处理。
 */
export function narrowPlan(agent, rule, cfg) {
  if (!cfg || cfg.toolNarrowing !== true) return null
  const then = (rule && rule.then) || {}
  const want = Array.isArray(then.tools) ? then.tools.filter((n) => typeof n === 'string' && n.trim()) : []
  if (want.length === 0) return null
  const svc = toolService(agent)
  if (!svc) return { allow: [], unknown: want, ok: false, reason: 'no-tools-service' }
  // 先问宿主"这个名字到底存不存在、能不能裁"——restrict 里出现一个未知名字就整体抛错
  const restrictable = new Set(want.filter((n) => n !== 'run_code' && isKnownTool(agent, n)))
  const plan = pickNarrow(rule, restrictable)
  if (!plan) return null
  if (!plan.ok) return { allow: [], unknown: plan.unknown, ok: false, reason: 'no-known-tool' }
  return { allow: plan.allow, unknown: plan.unknown, ok: true, reason: plan.unknown.length ? 'partial-unknown' : 'ok' }
}

function firedSet(sessionId) {
  let s = fired.get(sessionId)
  if (!s) {
    s = new Set()
    fired.set(sessionId, s)
    while (fired.size > 500) fired.delete(fired.keys().next().value)
  }
  return s
}

/**
 * 指令正文：先钉死"不要做什么"，再给"照抄这一句"，最后封住补充——三段缺一，
 * 模型就会自己加戏（这是条件反射层存在的意义：把自由度掐到 0）。
 */
export function buildDirective(rule, soft, narrow) {
  const t = rule.then || {}
  const narrowed = Boolean(narrow && narrow.ok)
  const lines = ['【条件反射·' + rule.id + '】' + (narrowed ? '命中了一条你写过的做法：这一步按它走。' : '用户问到了你的身份/立场。')]
  if (soft) {
    // 软命中（词袋通道）：措辞不同也可能中，所以要显式提醒模型先判断
    lines.push('本条是按关键词粗筛命中的，措辞可能不符——先判断用户是不是在问这件事；不是就完全忽略本条。')
  }
  // 工具裁剪规则是"这一步怎么做"，不能再说"不要调用任何工具"
  if (!narrowed) lines.push('不要调用任何工具，不要检索，不要解释理由，不要反问我。')
  if (t.reply) lines.push('直接用第一人称回答这一句（一字不改）：' + t.reply)
  if (t.directive) lines.push(t.directive)
  if (t.extra) lines.push(t.extra)
  if (narrowed) lines.push(NARROW_NOTE + '（本步点名：' + narrow.allow.join(' / ') + '）')
  lines.push('回答完立刻停住，不要再补充、不要再反问。')
  // 万能保险句（2026-09-20 加，触发来源：用户问模型自己会不会判断这是不是那个固定问题）：
  // 正则命中只是**字面**判断，可能误伤（实测「这段代码你是谁写的」曾被抓）。多这一行不额外占 token，
  // 却把最后一道判断权交回模型：真的不是在问身份，就忽略本条。
  lines.push('若本条与用户当前的问题无关，忽略本条，按问题本身正常回答。')
  return lines.join('\n')
}

export function registerReflex(ctx) {
  ensureFile()
  registerRequestHook(ctx, makeJsonlLog(path.join(configDir(), 'reflex.log.jsonl')))
  const logFile = path.join(configDir(), 'reflex.log.jsonl')
  const log = makeJsonlLog(logFile)

  ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
    let cfg
    try {
      cfg = loadRules()
    } catch {
      return next()
    }
    if (!cfg.enabled || !cfg.rules.length) return next()

    const texts = userTexts(messages)
    if (!texts.length) return next()
    const text = texts[texts.length - 1]
    const model = (agent && agent.options && agent.options.model) || ''
    const tier = tierOf(model)
    const sessionId = (agent && agent.session && agent.session.id) || 'unknown'
    // 一步一裁：上一步裁掉的东西，在本步开头放回去（误命中不会外溢到整场会话）
    liftNarrow(sessionId)

    let hit = null
    try {
      hit = matchRule(cfg.rules, { text, tier, model, normalized: normalize(text), fired: firedSet(sessionId) })
    } catch {
      hit = null
    }
    if (!hit) return next()
    const rule = hit.rule
    let narrow = null
    try {
      narrow = narrowPlan(agent, rule, cfg)
    } catch (e) {
      log({ phase: 'restrict-skip', rule: rule.id, error: String((e && e.message) || e) })
      narrow = null
    }
    const directive = buildDirective(rule, hit.soft, narrow)
    if (cfg.dryRun) {
      log({ phase: 'dry-run', rule: rule.id, via: hit.why, soft: hit.soft, tier, model, chars: text.length, directiveChars: directive.length, head: text.slice(0, 40) })
      if (narrow) log({ phase: 'restrict-dry', rule: rule.id, allow: narrow.allow, unknown: narrow.unknown, ok: narrow.ok, reason: narrow.reason })
      return next()
    }

    const downstream = await next()
    if (!downstream || downstream.kind !== 'enter') return downstream
    try {
      firedSet(sessionId).add(rule.id)
      // soft 一起带上：软命中的那一步**不瘦身**（见 registerRequestHook）
      pendingReflex.set(sessionId, { t: Date.now(), rule: rule.id, soft: hit.soft === true })
      // 步级工具裁剪：**只裁"看得见的工具"**，不裁这一层都碰不到的东西（非法/未知名字一律跳过）
      if (narrow) {
        if (!narrow.ok) {
          log({ phase: 'restrict-skip', rule: rule.id, reason: narrow.reason, unknown: narrow.unknown, tier, model })
        } else {
          try {
            const svc = agent.ctx.tools
            const before = measureTools(svc, agent)
            const lift = svc.restrict({ allow: narrow.allow })
            const after = measureTools(svc, agent)
            narrows.set(sessionId, { lift, rule: rule.id })
            log({
              phase: 'restrict', rule: rule.id, allow: narrow.allow, unknown: narrow.unknown, tier, model,
              toolsBefore: before ? before.count : null, charsBefore: before ? before.chars : null,
              toolsAfter: after ? after.count : null, charsAfter: after ? after.chars : null,
              savedChars: before && after ? before.chars - after.chars : null,
            })
          } catch (e) {
            log({ phase: 'restrict-skip', rule: rule.id, error: String((e && e.message) || e), tier, model })
          }
        }
      }
      // source **必须是对象**（宿主 session 校验器：user/message 的 message.source 要有非空 string kind，
      // dsh-session/lib/index.js:994-995）。2026-09-20 踩到：这里原先传的是字符串 'whale-reflex'，
      // 结果凡是命中过反射的会话，**历史都加载不出来**（客户端显示 "message has invalid source (gateway/internal)"）。
      const injected = makeUserMessage({
        content: [{ type: 'text', text: directive }],
        source: { kind: 'plugin', plugin: SOURCE, form: 'reflex' },
      })
      log({ phase: 'fire', rule: rule.id, via: hit.why, soft: hit.soft, tier, model, chars: text.length, directiveChars: directive.length, head: text.slice(0, 40) })
      return { ...downstream, messages: [...(downstream.messages || []), injected] }
    } catch {
      log({ phase: 'error', rule: rule.id, tier, model })
      return downstream
    }
  })
}

/** 轮 1：命中那一步的请求瘦身（见文件头 REFLEX_MAX_TOKENS 段） */
function registerRequestHook(ctx, log) {
  ctx.on('agent/request', async ({ agent }, next) => {
    const cfg = await next()
    try {
      const sessionId = (agent && agent.session && agent.session.id) || 'unknown'
      const mark = pendingReflex.get(sessionId)
      if (!mark || Date.now() - mark.t > REFLEX_WINDOW_MS) return cfg
      pendingReflex.delete(sessionId)
      // 软命中（词袋通道）**只注入指令，不动额度**（2026-09-20 拍板）：
      // 软命中自带「不符就完全忽略本条」，模型很可能去答你真正问的那个问题；
      // 这时把 maxTokens 压到 200 会把正常回答截断 —— 省 token 不能省掉正确性。
      // 硬命中（text / nearAny）是"我知道你在问这个"，才压得动。
      if (mark.soft) {
        log({ phase: 'request', rule: mark.rule, soft: true, clamped: false, maxTokens: cfg.maxTokens == null ? null : cfg.maxTokens, effort: cfg.reasoningEffort || null })
        return cfg
      }
      const out = { ...cfg }
      const before = { maxTokens: cfg.maxTokens, effort: cfg.reasoningEffort }
      const info = await modelEffortInfo(ctx, cfg)
      if (info.low) out.reasoningEffort = info.low
      // 压额度只在**压得动推理**时才做（2026-09-20 实测：模型只声明 high 时，200 token 全被推理吃掉，正文被截断——
      // 界面原话「已达到输出 token 上限，回答被截断」）。没有推理的模型照旧压。
      // 压额度的安全判据（2026-09-20 两次实测修正）：
      //   **这一步的请求本身带着推理档位**（cfg.reasoningEffort 有值）时，输出额度就是"推理+正文"共用的——
      //   只有**确实把推理降到低档**才敢压，否则 200 token 会被推理吃掉、正文被截断
      //   （界面原话「已达到输出 token 上限，回答被截断」，网页与子代理各撞一次）。
      //   别只信 listModels：本机那个模型 id 就查不到推理声明（hasReasoning:false），
      //   可 cfg.reasoningEffort 明明是 high —— **请求里带的才是事实**。
      const clampSafe = !cfg.reasoningEffort || Boolean(info.low)
      if (clampSafe) out.maxTokens = Math.min(Number(out.maxTokens) || REFLEX_MAX_TOKENS, REFLEX_MAX_TOKENS)
      log({
        phase: 'request', rule: mark.rule, maxTokens: out.maxTokens == null ? null : out.maxTokens,
        effort: out.reasoningEffort || null, wasEffort: before.effort || null,
        wasMax: before.maxTokens == null ? null : before.maxTokens,
        clamped: clampSafe, effortLowered: Boolean(info.low), hasReasoning: info.hasReasoning,
      })
      return out
    } catch {
      return cfg
    }
  })
}

/**
 * 只读状态 / 试命中：**留给 UI 包（adapters/dsh-ui）去挂路由** ——
 * 本模块只算，不开 HTTP（路由与面板同属浏览器半身那一层，宿主壳这里保持"零服务依赖"）。
 */
export { reflexState, reflexTest }

/** 便于测试与自查：当前生效的规则文件路径与开关状态 */
export function describe() {
  const cfg = loadRules()
  return { file: rulesPath(), enabled: cfg.enabled, dryRun: cfg.dryRun, rules: cfg.rules.map((r) => r.id) }
}
