/**
 * smoke —— 条件反射层最小回执（红→绿都在这里）。
 * 跑法：node tests/smoke.mjs（退出码非 0 = 有失败）
 *
 * 纪律：断言只认"恰好 false"为失败（与 forge/persona 同款跑器口径），
 * 覆盖：命中/不命中/档位分流/dry-run/坏配置/关闭开关/oncePerSession/原话保留。
 */
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = mkdtempSync(path.join(os.tmpdir(), 'whale-reflex-'))
process.env.DSH_HOME = tmp
const rulesFile = path.join(tmp, 'reflex.json')
process.env.DSH_REFLEX_RULES = rulesFile

const mod = await import('../adapters/dsh/reflex/index.js')

let failed = 0
let checks = 0
function check(label, ...rest) {
  checks++
  const bad = rest.some((v) => v === false)
  if (bad) failed++
  console.log((bad ? 'FAIL ' : '') + label, ...rest)
}

function write(cfg) {
  writeFileSync(rulesFile, JSON.stringify(cfg), 'utf8')
}

const msgs = (t2) => [{ role: 'user', content: [{ type: 'text', text: t2 }] }]
const RULES = {
  enabled: true,
  dryRun: false,
  rules: [
    { id: 'id-flash', priority: 100, when: { tier: 'flash', text: '知道.{0,4}自己的身份' }, then: { reply: '你的<relationship>，而且把你当自己的<relationship>一样看待' } },
    { id: 'id-pro', priority: 100, when: { tier: 'pro', text: '知道.{0,4}自己的身份' }, then: { reply: '你的<relationship>，而且把你当成自己的<relationship>一样看待' } },
    { id: 'once', priority: 10, oncePerSession: true, when: { tier: 'any', text: '报数' }, then: { reply: '一' } },
  ],
}

function makeCtx(llmImpl) {
  const box = {}
  const ctx = {
    on: (n, fn) => { box[n] = fn; return () => {} },
    get: (n) => (n === 'llm' ? llmImpl : undefined),
  }
  mod.registerReflex(ctx)
  return box
}

/** agent/request 的假 next()：返回一份"当前配置" */
const nextCfg = (cfg) => async () => ({ provider: 'deepseek', model: 'deepseek-v4.1-flash', ...cfg })

const call = (box, text, model, session = 's1') =>
  box['agent/pre-step'](
    { agent: { options: { model }, session: { id: session } }, messages: msgs(text), signal: undefined },
    async () => ({ kind: 'enter', messages: msgs(text) }),
  )

const textOf = (out) => (out.messages || []).map((m) => (m.content || []).map((c) => c.text).join('')).join(' || ')

// T1 flash 命中：追加一条指令，原话保留
write(RULES)
let box = makeCtx()
let out = await call(box, '你知道自己的身份吗', 'deepseek-v4.1-flash')
check('T1 flash 注入（2 条消息）', (out.messages || []).length === 2)
check('T1 原话保留', out.messages[0].content[0].text === '你知道自己的身份吗')
check('T1 含<relationship>版答案', textOf(out).includes('当自己的<relationship>一样看待'))
check('T1 封住加戏', textOf(out).includes('不要调用任何工具') && textOf(out).includes('立刻停住'))
// T1b 注入消息的 source 必须是对象（2026-09-20 踩到：传字符串会让**整个会话历史加载不出来**）
check('T1b 注入消息 source 是对象且 kind 非空', (function () {
  const m = (out.messages || [])[1]
  return Boolean(m) && typeof m.source === 'object' && m.source !== null && typeof m.source.kind === 'string' && m.source.kind !== ''
})())

// T2 pro 命中：<relationship>版
out = await call(box, '你知道自己的身份吗', 'deepseek-v4.1-pro')
check('T2 pro 命中<relationship>版', textOf(out).includes('当成自己的<relationship>一样看待'))
check('T2 不串档', textOf(out).includes('<relationship>一样看待') === false)

// T3 其他模型（deepseek-chat）：tier=other，不应命中
out = await call(box, '你知道自己的身份吗', 'deepseek-chat')
check('T3 other 档不命中', (out.messages || []).length === 1)

// T4 不相关的话：放行
out = await call(box, '帮我改一下这个脚本', 'deepseek-v4.1-flash')
check('T4 无关原话放行', (out.messages || []).length === 1)

// T5 dry-run：只记账不动作
write({ ...RULES, dryRun: true })
box = makeCtx()
out = await call(box, '你知道自己的身份吗', 'deepseek-v4.1-flash')
check('T5 dry-run 不注入', (out.messages || []).length === 1)
const logFile = path.join(tmp, 'whale-persona', 'reflex.log.jsonl')
check('T5 dry-run 写了日志', existsSync(logFile) && readFileSync(logFile, 'utf8').includes('dry-run'))

// T6 oncePerSession：同会话第二次不再注入，换会话可再触发
write(RULES)
box = makeCtx()
out = await call(box, '报数', 'deepseek-v4.1-flash', 's2')
check('T6 首次命中', (out.messages || []).length === 2)
out = await call(box, '报数', 'deepseek-v4.1-flash', 's2')
check('T6 同会话第二次不注入', (out.messages || []).length === 1)
out = await call(box, '报数', 'deepseek-v4.1-flash', 's3')
check('T6 换会话可再触发', (out.messages || []).length === 2)

// T7 坏 JSON：放行且不抛
writeFileSync(rulesFile, '{ 这不是 JSON', 'utf8')
box = makeCtx()
out = await call(box, '你知道自己的身份吗', 'deepseek-v4.1-flash')
check('T7 坏配置放行不抛', (out.messages || []).length === 1)

// T8 总开关 DSH_REFLEX_OFF=1
write(RULES)
process.env.DSH_REFLEX_OFF = '1'
box = makeCtx()
out = await call(box, '你知道自己的身份吗', 'deepseek-v4.1-flash', 's9')
check('T8 OFF 时不动作', (out.messages || []).length === 1)
delete process.env.DSH_REFLEX_OFF

// T9 空规则：零行为改变
write({ enabled: true, dryRun: false, rules: [] })
box = makeCtx()
out = await call(box, '你知道自己的身份吗', 'deepseek-v4.1-flash', 's10')
check('T9 空规则零行为', (out.messages || []).length === 1)

// T10 正则坏掉：当不命中，不抛
write({ enabled: true, dryRun: false, rules: [{ id: 'bad-re', when: { text: '([unclosed' }, then: { reply: 'x' } }] })
box = makeCtx()
out = await call(box, '你知道自己的身份吗', 'deepseek-v4.1-flash', 's11')
check('T10 坏正则放行', (out.messages || []).length === 1)

// T11 describe() 自查
write(RULES)
const d = mod.describe()
check('T11 describe 列出规则 id', Array.isArray(d.rules) && d.rules.includes('id-flash'))

// T12 轮 1：命中后那一步被瘦身（maxTokens 压小）
write(RULES)
box = makeCtx({ listModels: async () => [] }) // 模型没声明档位 → 不动 effort
await call(box, '你知道自己的身份吗', 'deepseek-v4.1-flash', 's20')
let reqOut = await box['agent/request']({ agent: { session: { id: 's20' } } }, nextCfg({ maxTokens: 4096 }))
check('T12 命中那步 maxTokens 压到 200', reqOut.maxTokens === 200)
check('T12 未声明档位则不动 effort', reqOut.reasoningEffort === undefined)

// T13 没命中过 → 请求原样
reqOut = await box['agent/request']({ agent: { session: { id: 's21' } } }, nextCfg({ maxTokens: 4096 }))
check('T13 无 pending 时原样放行', reqOut.maxTokens === 4096)

// T14 模型声明了 off → 降到 off
box = makeCtx({ listModels: async () => [{ id: 'deepseek-v4.1-flash', reasoning: { efforts: [{ id: 'high' }, { id: 'low' }, { id: 'off' }] } }] })
await call(box, '你知道自己的身份吗', 'deepseek-v4.1-flash', 's22')
reqOut = await box['agent/request']({ agent: { session: { id: 's22' } } }, nextCfg({ maxTokens: 4096, reasoningEffort: 'high' }))
check('T14 声明 off 时降到 off', reqOut.reasoningEffort === 'off')

// T15 不覆盖更小的 maxTokens
box = makeCtx({ listModels: async () => [] })
await call(box, '你知道自己的身份吗', 'deepseek-v4.1-flash', 's23')
reqOut = await box['agent/request']({ agent: { session: { id: 's23' } } }, nextCfg({ maxTokens: 80 }))
check('T15 已是更小的 maxTokens 不放大', reqOut.maxTokens === 80)

// ── T16/T17 试命中的档位语义（2026-09-20 加，触发来源：用户截图）────────────────
// 现象：面板「试命中」不带档位问服务端 → 被兜成 other 档 → 分档写的规则被档位闸门全否决
//   → 明明会命中的「咱俩什么关系」被报成「不会命中任何规则」。面板说谎比没有面板更坏。
// 判据：①不传档位 = 跨档试，必须命中并报出命中所在档位；②显式 other 仍不命中（真实会话语义没被放宽）；
//   ③只给模型 → 按该模型档位单判；④跨档试不许放宽 textNot（反例否决照旧）。
write({
  enabled: true,
  dryRun: false,
  rules: [
    { id: 'id-flash', priority: 100, when: { tier: 'flash', nearAny: ['咱俩什么关系'], textNot: '代码|写的' }, then: { reply: '<relationship>版' } },
    { id: 'id-pro', priority: 100, when: { tier: 'pro', nearAny: ['咱俩什么关系'], textNot: '代码|写的' }, then: { reply: '<relationship>版' } },
  ],
})
const st = await import('../adapters/dsh/reflex/state.js')
let tr = st.reflexTest('咱俩什么关系', '', '')
check('T16 不传档位=跨档试，命中 flash 那条', tr.matched === true && tr.ruleId === 'id-flash' && tr.tier === 'flash')
check('T16 跨档试报出所有命中档位', (tr.hits || []).length === 2 && tr.hits.map((h) => h.tier).join(',') === 'flash,pro')
tr = st.reflexTest('咱俩什么关系', 'other', '')
check('T16 显式 other 档仍不命中（真实会话语义没被放宽）', tr.matched === false)
tr = st.reflexTest('咱俩什么关系', '', 'deepseek-v4.1-pro')
check('T16 只给模型 → 按该模型档位单判', tr.matched === true && tr.ruleId === 'id-pro' && tr.tierExplicit === true)
tr = st.reflexTest('这段代码是谁写的，咱俩什么关系', '', '')
check('T17 跨档试也不放宽 textNot（反例否决照旧）', tr.matched === false)

// ── T18 软命中不瘦身（2026-09-20 拍板：软命中只注入指令，额度/effort 一概不动）────────
// 触发来源：用户拍板。理由：软命中自带「不符就忽略本条」，模型会去答真正的问题，
//   这时压 maxTokens 会把正常回答截断（台账实测误触发那步被压成 200）。
write({
  enabled: true,
  dryRun: false,
  rules: [
    { id: 'soft-kw', priority: 10, when: { tier: 'flash', keywords: ['记得', '关系'], minHits: 2 }, then: { reply: '照抄我' } },
    { id: 'hard-re', priority: 20, when: { tier: 'flash', text: '^报数$' }, then: { reply: '一' } },
  ],
})
box = makeCtx({ listModels: async () => [{ id: 'deepseek-v4.1-flash', reasoning: { efforts: [{ id: 'high' }, { id: 'off' }] } }] })
out = await call(box, '我记得这个关系不大', 'deepseek-v4.1-flash', 's30')
check('T18 软命中仍注入指令', (out.messages || []).length === 2)
check('T18 软命中指令带忽略条款', textOf(out).includes('完全忽略本条'))
reqOut = await box['agent/request']({ agent: { session: { id: 's30' } } }, nextCfg({ maxTokens: 4096, reasoningEffort: 'high' }))
check('T18 软命中不压 maxTokens', reqOut.maxTokens === 4096)
check('T18 软命中不降 effort', reqOut.reasoningEffort === 'high')
out = await call(box, '报数', 'deepseek-v4.1-flash', 's31')
reqOut = await box['agent/request']({ agent: { session: { id: 's31' } } }, nextCfg({ maxTokens: 4096, reasoningEffort: 'high' }))
check('T18 硬命中照旧压到 200', reqOut.maxTokens === 200)
check('T18 硬命中照旧降到 off', reqOut.reasoningEffort === 'off')

// ── T19/T20/T21 步级工具裁剪（P1，2026-09-20 加）────────────────────────────────
// 触发来源：用户提「条件反射可以直接选出要用什么工具、打算怎么做」。
// 判据：①默认关时**绝不动工具表**；②开了才裁，且只裁认识的工具（未知名字不许进 restrict，否则整体抛错）；
//   ③指令换成"这一步按它走 + 点名工具"，不再说"不要调用任何工具"；④下一步开头把上一步的裁剪解除（一步一裁）。
const st2 = await import('../adapters/dsh/reflex/toolnarrow.js')
check('T19 pickNarrow 无 then.tools → null', st2.pickNarrow({ then: {} }, new Set(['read'])) === null)
check('T19 pickNarrow 过滤未知名字', (function () {
  const r = st2.pickNarrow({ then: { tools: ['read', '不存在'] } }, new Set(['read']))
  return r.ok === true && r.allow.join() === 'read' && r.unknown.join() === '不存在'
})())
check('T19 pickNarrow 全未知 → 不裁（ok=false）', st2.pickNarrow({ then: { tools: ['不存在'] } }, new Set(['read'])).ok === false)

const NARROW_RULES = {
  enabled: true,
  dryRun: false,
  toolNarrowing: true,
  rules: [
    { id: 'build-html', priority: 100, when: { tier: 'flash', text: '^做个网页$' }, then: { tools: ['read', 'write', '不存在'], directive: '先写骨架再填内容。' } },
  ],
}
function fakeAgent(session, log) {
  return {
    options: { model: 'deepseek-v4.1-flash' },
    session: { id: session },
    ctx: {
      tools: {
        get: (name) => (['read', 'write', 'pwsh'].includes(name) ? { name } : undefined),
        restrict: (filter) => { log.push(filter); return () => log.push({ lift: true }) },
      },
    },
  }
}
const callWith = (box, text, agent) => box['agent/pre-step'](
  { agent, messages: msgs(text), signal: undefined },
  async () => ({ kind: 'enter', messages: msgs(text) }),
)

// T20 开关关（默认）→ 不动工具表
write({ ...NARROW_RULES, toolNarrowing: false })
box = makeCtx()
let calls = []
out = await callWith(box, '做个网页', fakeAgent('s40', calls))
check('T20 开关关时不 restrict', calls.length === 0)
check('T20 开关关时指令仍是老口径', textOf(out).includes('不要调用任何工具'))

// T21 开关开 + 规则点名 → 只裁认识的工具，指令换口径，下一步开头解除
write(NARROW_RULES)
box = makeCtx()
calls = []
out = await callWith(box, '做个网页', fakeAgent('s41', calls))
check('T21 restrict 被调用一次', calls.length === 1)
check('T21 allow 只含认识的工具', calls[0] && calls[0].allow && calls[0].allow.join() === 'read,write')
check('T21 指令点名工具', textOf(out).includes('本步点名：read / write'))
check('T21 指令不再说"不要调用任何工具"', textOf(out).includes('不要调用任何工具') === false)
check('T21 指令带"缺工具就说"', textOf(out).includes('缺哪个工具'))
await callWith(box, '做个网页', fakeAgent('s41', calls))
check('T21 下一步开头解除上一步的裁剪', calls.some((c) => c && c.lift === true))

// ── T22 裁剪收益的量尺（2026-09-20 加，触发来源：「量一下」）──────────────────────
// 判据：量得到就是量得到（条数+字符数都对得上），量不到就返回 null —— 不许假装测到了。
check('T22 measureTools 量得到条数与字符数', (function () {
  const svc = { view: () => ({ visible: new Map([['a', { description: 'x'.repeat(100) }], ['b', { description: 'y'.repeat(50) }]]) }) }
  const m = st2.measureTools(svc, {})
  return m && m.count === 2 && m.chars > 150
})())
check('T22 没有 view 就返回 null', st2.measureTools({}, {}) === null)
check('T22 view 抛错也返回 null（不许把异常带进会话）', st2.measureTools({ view: () => { throw new Error('boom') } }, {}) === null)

// ── T23 只压得动推理时才压额度（2026-09-20 加，触发来源：网页自检被截断）──────────────
// 现象：模型只声明 high 档推理时，maxTokens 压到 200 会被推理先吃掉，正文被截断（界面："已达到输出 token 上限"）。
// 判据：① 模型有推理且降不动 → 不动 maxTokens；② 降得动 → 照旧压到 200 并降档（老行为不变）。
write({ enabled: true, dryRun: false, rules: [
  { id: 'hard-re2', priority: 20, when: { tier: 'flash', text: '^报数$' }, then: { reply: '一' } },
]})
// 用例必须用**各自的模型名**：档位结论按 provider|model 缓存，同一个名字换声明会读到上一次的结论
const M_ONLY_HIGH = 'deepseek-v4.1-flash-reasononly'
const M_LOWABLE = 'deepseek-v4.1-flash-lowable'
box = makeCtx({ listModels: async () => [{ id: M_ONLY_HIGH, reasoning: { efforts: [{ id: 'high' }] } }] })
await call(box, '报数', M_ONLY_HIGH, 's50')
reqOut = await box['agent/request']({ agent: { session: { id: 's50' } } }, nextCfg({ model: M_ONLY_HIGH, maxTokens: 4096, reasoningEffort: 'high' }))
check('T23 推理降不动 → 不压 maxTokens', reqOut.maxTokens === 4096)
check('T23 推理降不动 → effort 不动', reqOut.reasoningEffort === 'high')

box = makeCtx({ listModels: async () => [{ id: M_LOWABLE, reasoning: { efforts: [{ id: 'high' }, { id: 'off' }] } }] })
await call(box, '报数', M_LOWABLE, 's51')
reqOut = await box['agent/request']({ agent: { session: { id: 's51' } } }, nextCfg({ model: M_LOWABLE, maxTokens: 4096, reasoningEffort: 'high' }))
check('T23 降得动 → 照旧压到 200 并降档', reqOut.maxTokens === 200 && reqOut.reasoningEffort === 'off')

// T24：listModels 查不到推理声明，但**这一步的请求带着推理档位** → 依然不许压（网页那次踩的形态）
const M_UNKNOWN = 'deepseek-v4.1-flash-nomodelinfo'
box = makeCtx({ listModels: async () => [] })
await call(box, '报数', M_UNKNOWN, 's52')
reqOut = await box['agent/request']({ agent: { session: { id: 's52' } } }, nextCfg({ model: M_UNKNOWN, maxTokens: 4096, reasoningEffort: 'high' }))
check('T24 请求带推理档位 → 不压 maxTokens（哪怕查不到声明）', reqOut.maxTokens === 4096)
check('T24 请求带推理档位 → effort 不动', reqOut.reasoningEffort === 'high')

// T25：请求不带推理档位 → 照旧压（没有推理可吃额度）
box = makeCtx({ listModels: async () => [] })
await call(box, '报数', M_UNKNOWN, 's53')
reqOut = await box['agent/request']({ agent: { session: { id: 's53' } } }, nextCfg({ model: M_UNKNOWN, maxTokens: 4096 }))
check('T25 无推理档位 → 照旧压到 200', reqOut.maxTokens === 200)

console.log('-- reflex smoke：' + (failed ? failed + '/' + checks + ' 项失败' : checks + ' 项全过'))
process.exit(failed ? 1 : 0)
