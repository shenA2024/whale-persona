// 设置面板·宿主半身测试（2026-09-18 新增；同日补"可保存"后的写路径）
// 断言强制：任一 false 即非零退出（与 smoke.mjs 同一约定）
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import os from 'node:os'
import path from 'node:path'

const home = mkdtempSync(path.join(os.tmpdir(), 'whale-persona-panel-'))
process.env.DSH_HOME = home
process.env.DSH_WHALE_CONFIG = path.join(home, 'whale-persona', 'config.json')
const CFG = process.env.DSH_WHALE_CONFIG
mkdirSync(path.dirname(CFG), { recursive: true })
writeFileSync(CFG, JSON.stringify({
  enabled: true,
  thinkingLanguage: 'zh-CN',
  persona: {
    enabled: true,
    selfNameFlash: '小助手', selfNamePro: '首席助手', userName: '小林',
    character: '你是{selfName}，{userName}的编程搭档。',
    contracts: [{ id: 'terse', text: '结论先行。', on: true }, { id: 'off-one', text: '这条关了', on: false }],
  },
  memory: { enabled: true, entries: [{ text: '小林喜欢先看证据' }], inbox: true },
  forge: { enabled: true, tier: 'standard' },
  context: { root: 'D:/somewhere' },
}), 'utf8')
writeFileSync(path.join(home, 'whale-persona', 'memory-inbox.jsonl'),
  JSON.stringify({ text: '交付用简体中文', at: '2026-09-18T00:00:00Z' }) + '\n', 'utf8')

const t = (name, ok) => { console.log(name + ':', ok); if (!ok) process.exitCode = 1 }

const mod = await import('../adapters/dsh-ui/index.js')
t('P1 插件名', mod.name === '@shenA2024/whale-persona-ui')
t('P2 inject 声明 webServer', Array.isArray(mod.inject) && mod.inject.indexOf('webServer') >= 0)

let route = null
const ctx = { effect: (fn) => { fn(); return () => {} }, webServer: { register: (r) => { route = r; return () => {} } } }
mod.apply(ctx)
t('P3 注册 prefix 路由', !!route && route.kind === 'prefix' && route.path === '/whale-persona/api')

function fakeRes() {
  const out = { code: 0, body: '' }
  return { writeHead(code) { out.code = code }, end(text) { out.body = text || '' }, result: out }
}
function fakeReq(o) {
  const em = new EventEmitter()
  em.url = o.url
  em.method = o.method || 'GET'
  em.headers = Object.assign({ host: o.host || '127.0.0.1:3081' }, o.headers || {})
  if (o.body !== undefined) {
    queueMicrotask(() => { em.emit('data', Buffer.from(o.body)); em.emit('end') })
  }
  return em
}
async function call(url, opt) {
  const o = opt || {}
  const res = fakeRes()
  await route.handler(fakeReq({ url, method: o.method, host: o.host, headers: o.headers, body: o.body }), res)
  let json = null
  try { json = JSON.parse(res.result.body) } catch { /* 非 JSON */ }
  return { code: res.result.code, json }
}

const a = await call('/whale-persona/api/summary')
t('P4 200 + ok', a.code === 200 && !!a.json && a.json.ok === true)
t('P5 人设段与运行期同源', !!a.json && a.json.sections.prefix.indexOf('小助手') >= 0 && a.json.sections.prefix.indexOf('小林') >= 0)
t('P6 契约带开关态', !!a.json && a.json.contracts.length === 2 && a.json.contracts[1].on === false)
t('P7 收件箱按数据呈现', !!a.json && a.json.memory.recent.length === 1 && a.json.memory.recent[0].text === '交付用简体中文')
t('P8 思维链语言段', !!a.json && a.json.sections.thinking.indexOf('简体中文') >= 0)
t('P9 raw 可供表单回填（含未知键）', !!a.json && !!a.json.raw && !!a.json.raw.forge && a.json.raw.forge.enabled === true)
t('P9b defaults 出厂值下发', !!a.json && !!a.json.defaults && a.json.defaults.persona !== undefined)
t('P9c configValid=true', !!a.json && a.json.configValid === true)
t('P10 换档渲染', (await call('/whale-persona/api/summary?tier=pro')).json.selfName.pro === '首席助手')
t('P11 非 loopback host 拒答', (await call('/whale-persona/api/summary', { host: 'evil.example.com:3081' })).code === 403)
t('P12 换端口仍放行（不绑死 3080）', (await call('/whale-persona/api/summary', { host: '127.0.0.1:9999' })).code === 200)
t('P13 未知路径 404', (await call('/whale-persona/api/nope')).code === 404)
t('P14 POST 到只读路径不误答', (await call('/whale-persona/api/summary', { method: 'POST' })).code === 404)
t('P15 origin 护栏', (await call('/whale-persona/api/summary', { headers: { origin: 'http://evil.example.com' } })).code === 403)

const before = JSON.parse(readFileSync(CFG, 'utf8'))
const patch = {
  enabled: true,
  thinkingLanguage: 'en',
  persona: Object.assign({}, before.persona, { userName: '小林', selfNameFlash: '小助手' }),
  memory: Object.assign({}, before.memory, { enabled: false }),
}
const w = await call('/whale-persona/api/config', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ config: patch }),
})
t('P16 保存 200 + 回显', w.code === 200 && !!w.json && w.json.ok === true)
const after = JSON.parse(readFileSync(CFG, 'utf8'))
t('P17 改的字段落盘', after.persona.userName === '小林' && after.thinkingLanguage === 'en')
t('P18 未知键原样保留', !!after.forge && after.forge.enabled === true && !!after.context && after.context.root === 'D:/somewhere')
t('P19 保存返回新预览', !!w.json && !!w.json.preview && w.json.preview.prefix.indexOf('小助手') >= 0)
t('P20 保存返回告警数组', !!w.json && Array.isArray(w.json.preview.warnings))

const ct = await call('/whale-persona/api/config', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })
t('P21 非 JSON content-type → 415', ct.code === 415)
const bad = await call('/whale-persona/api/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' })
t('P22 body 不是 JSON → 400', bad.code === 400)
const nocfg = await call('/whale-persona/api/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nope: 1 }) })
t('P23 缺 config → 400', nocfg.code === 400)
const evil = await call('/whale-persona/api/config', { method: 'POST', host: 'evil.example.com:3081', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ config: patch }) })
t('P24 非 loopback 写入 → 403', evil.code === 403)

writeFileSync(CFG, '{ this is not json', 'utf8')
const brokenWrite = await call('/whale-persona/api/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ config: patch }) })
t('P25 现有文件坏 JSON → 409 拒写', brokenWrite.code === 409)
t('P26 坏文件没被覆盖', readFileSync(CFG, 'utf8') === '{ this is not json')
const brokenRead = await call('/whale-persona/api/summary')
t('P27 坏文件时 summary 仍 200 且 configValid=false', brokenRead.code === 200 && brokenRead.json.configValid === false && brokenRead.json.raw === null)

/* ─────────── 0.9.0 追加：形象 / 语气（appearance / tone）的面板对接 ───────────
 * 只追加，P1–P27 一条不动。P25–P27 故意把配置文件写坏了，所以先重新铺一份合法配置再验。
 * 这一段的写路径全部走**真实的浏览器半身代码**（client.js 的 formFrom / buildPatch），
 * 不是在这里手写一份 patch 自证 —— 那样测不到未知子键会不会被面板裁掉。
 */

// 配置里预置一条「别的工具写的未知子键」：面板保存一次不许把它裁掉
writeFileSync(CFG, JSON.stringify({
  enabled: true,
  thinkingLanguage: 'zh-CN',
  persona: {
    enabled: true,
    selfNameFlash: '小助手', selfNamePro: '首席助手', userName: '小林',
    character: '你是{selfName}，{userName}的编程搭档。',
    appearance: { enabled: false, text: '', byModel: {}, futureKey: '别的工具写的未知子键' },
    contracts: [{ id: 'terse', text: '结论先行。', on: true }],
  },
  memory: { enabled: true, entries: [{ text: '小林喜欢先看证据' }], inbox: true },
  forge: { enabled: true, tier: 'standard' },
}), 'utf8')

const s2 = await call('/whale-persona/api/summary')
const { TONE_PRESETS } = await import('../core/presets.js')
t('N1 summary 下发语气预设 4 条，且与 core/presets.js 是同一份',
  !!s2.json && Array.isArray(s2.json.tonePresets) && s2.json.tonePresets.length === 4
  && JSON.stringify(s2.json.tonePresets) === JSON.stringify(TONE_PRESETS))
// 宿主真实模型 id 也要端给前端（「按模型」条目关键词该写什么，2026-09-19 实测踩坑后加）
t('N1b summary 带 lastModel 字段（没记录时为空串，不炸）', !!s2.json && typeof s2.json.lastModel === 'string')

// 浏览器半身：桩一个 __ModuleLoader__ / react 加载 client.js（顺带验它语法可加载），
// 然后拿它真正暴露的纯函数做断言。
let loadedClient = null
let clientHooks = null
globalThis.window = { __ModuleLoader__: { load: (m) => { loadedClient = m } } }
globalThis.__WPR_TEST_HOOK__ = (api) => { clientHooks = api }
const ReactStub = {
  createElement: function (type, props) {
    const kids = Array.prototype.slice.call(arguments, 2)
    return { type, props: Object.assign({}, props, kids.length ? { children: kids.length === 1 ? kids[0] : kids } : {}) }
  },
  useState: (v) => [v, () => {}], useEffect: () => {}, useRef: (v) => ({ current: v }), useCallback: (f) => f,
}
await import('../adapters/dsh-ui/client.js')
const clientExports = loadedClient.factory((id) => {
  if (id === 'react') return ReactStub
  throw new Error('意外的 require：' + id)
})
clientExports.apply({ effect: (fn) => { fn(); return () => {} }, slots: { inject: () => {}, register: () => {} } })
const H = clientHooks

// 表单 → patch：磁盘 raw 优先 + 未知子键必须活着穿过 buildPatch
const view = { raw: s2.json.raw, defaults: s2.json.defaults, hasRaw: true }
const f = H.formFrom(view)
f.appearanceEnabled = true
f.appearanceText = '你是一位 20 岁的女性，身高 1.75 m。'
f.appearanceRows = [{ keep: {}, key: 'glm-5.1', value: 'GLM 下：你是小五。' }]
const stylePatch = H.buildPatch(f, view)
t('N2 formFrom / buildPatch：形象形状对得上，且 raw 里的未知子键不被裁',
  f.appearanceEnabled === true && f.appearanceText === '你是一位 20 岁的女性，身高 1.75 m。'
  && !!stylePatch.persona.appearance
  && stylePatch.persona.appearance.enabled === true
  && stylePatch.persona.appearance.text === '你是一位 20 岁的女性，身高 1.75 m。'
  && stylePatch.persona.appearance.byModel['glm-5.1'] === 'GLM 下：你是小五。'
  && stylePatch.persona.appearance.futureKey === '别的工具写的未知子键'
  && !!stylePatch.persona.tone && stylePatch.persona.tone.enabled === false
  && Object.keys(stylePatch.persona.tone.byModel).length === 0)

// 落盘：POST 这条 patch（POST body 就是面板会发出去的那一份）
const w2 = await call('/whale-persona/api/config', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ config: stylePatch }),
})
const disk = JSON.parse(readFileSync(CFG, 'utf8'))
const ap = (disk.persona || {}).appearance || {}
t('N3 保存落盘：appearance 形状正确 + 未知子键仍在 + 预览里真的注入【形象设定】',
  w2.code === 200 && ap.enabled === true && ap.text === '你是一位 20 岁的女性，身高 1.75 m。'
  && Object.keys(ap.byModel).length === 1 && ap.byModel['glm-5.1'] === 'GLM 下：你是小五。'
  && ap.futureKey === '别的工具写的未知子键'
  && (disk.persona.tone || {}).enabled === false
  && !!w2.json && !!w2.json.preview && w2.json.preview.prefix.indexOf('【形象设定】') >= 0)

// 渲染：泛化后的 ByModelCard 文案逐字不许退化；形象卡 / 语气卡要件齐全
function flatText(node) {
  const out = []
  const walk = (n) => {
    if (n === null || n === undefined || n === false || n === true) return
    if (Array.isArray(n)) { n.forEach(walk); return }
    if (typeof n === 'string' || typeof n === 'number') { out.push(String(n)); return }
    if (typeof n !== 'object') return
    if (typeof n.type === 'function') { walk(n.type(n.props)); return }
    // 输入框的 placeholder / value 也算文案：占位符退化了要能被这条断言抓住
    if (n.type === 'input' || n.type === 'textarea') {
      const p = n.props || {}
      out.push(String(p.placeholder === undefined ? '' : p.placeholder))
      out.push(String(p.value === undefined ? '' : p.value))
    }
    walk(n.props ? n.props.children : null)
  }
  walk(node)
  return out.join(' ')
}
const noop = () => {}
const SC = H.selfNameCard
const selfCardProps = {
  disabled: false, title: SC.title, empty: SC.empty,
  keyPlaceholder: SC.keyPlaceholder, valuePlaceholder: SC.valuePlaceholder, notes: SC.notes,
  onPatch: noop, onRemove: noop, onAdd: noop,
}
const selfCard = flatText(H.ByModelCard(Object.assign({}, selfCardProps, {
  value: [{ keep: {}, key: 'grok-4.7', value: '小七' }], subtitle: SC.subtitle(1),
})))
const selfCardEmpty = flatText(H.ByModelCard(Object.assign({}, selfCardProps, {
  value: [], subtitle: SC.subtitle(0),
})))
const cardProps = {
  enabled: true, text: '你是一位 20 岁的女性，身高 1.75 m。',
  rows: [{ keep: {}, key: 'glm-5.1', value: 'GLM 下：你是小五。' }],
  disabled: false, onToggleEnabled: noop, onText: noop, onPatch: noop, onRemove: noop, onAdd: noop,
}
const appearanceCard = flatText(H.StyleCard(Object.assign({}, cardProps, {
  title: '形象（appearance）', switchLabel: '启用形象设定',
  switchHint: '默认关（opt-in）：关着的时候，下面填了内容也不会注入。',
  placeholder: '例：你是一位 20 岁的女性，身高 1.75 m。',
  keyPlaceholder: '模型关键词，如 deepseek-v4.1-flash', valuePlaceholder: '这个模型下的形象',
  empty: '（没配就所有模型都用上面的通用文本）', notes: ['匹配顺序：精确命中 → 最长子串命中。'],
  note: '形象是 opt-in 的：开关关着时，这一段在系统提示词里完全不出现。',
})))
const toneCard = flatText(H.StyleCard(Object.assign({}, cardProps, {
  title: '回复语气（tone）', switchLabel: '启用回复语气',
  switchHint: '默认关（opt-in）：关着的时候，下面填了内容也不会注入。', enabled: false, text: '',
  rows: [], placeholder: '例：语气温柔有耐心。',
  presets: [{ id: 'serious', label: '严肃', text: '语气严肃克制……' }, { id: 'gentle', label: '温柔', text: '语气温和有耐心……' }],
  onUsePreset: noop, keyPlaceholder: '模型关键词，如 glm-5.1', valuePlaceholder: '这个模型下的语气',
  empty: '（没配就所有模型都用上面的通用文本）', notes: [], note: '语气是 opt-in 的。',
})))
const selfCardSame = [
  '按模型指定自称', '1 条 · 逐模型覆盖上面两档',
  '模型关键词，如 grok-4.7', '自称，如 小七', '+ 加一条',
  '匹配顺序：精确命中 → 最长子串命中 → 都没中才回落到上面两档。例：关键词 grok-4.7 → 自称 小七，能命中 x-ai/grok-4.7-flash。',
  '关键词按子串匹配、忽略大小写；空关键词或空自称的行保存时会丢弃。',
].every((x) => selfCard.indexOf(x) >= 0)
  && ['按模型指定自称', '0 条 · 逐模型覆盖上面两档', '（没配就只用上面两档）'].every((x) => selfCardEmpty.indexOf(x) >= 0)
t('N4 渲染：自称卡文案逐字未退化 + 形象 / 语气卡要件齐全（徽标 / 开关 / 通用文本 / 按模型表 / 预设按钮）',
  selfCardSame
  && ['形象（appearance）', '已启用', '1 条按模型覆盖 · 未命中回落通用文本', '总开关', '启用形象设定',
    '通用文本', '按模型覆盖', '+ 加一条', '匹配顺序'].every((x) => appearanceCard.indexOf(x) >= 0)
  && ['回复语气（tone）', '关（默认关 · opt-in）', '启用回复语气', '预设', '严肃', '温柔', '关着的时候，下面填了内容也不会注入']
    .every((x) => toneCard.indexOf(x) >= 0))
