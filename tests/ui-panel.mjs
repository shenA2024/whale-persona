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
