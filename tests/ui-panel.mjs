// 设置面板·宿主半身测试（2026-09-18 新增）
// 断言强制：任一 false 即非零退出（与 smoke.mjs 同一约定）
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const home = mkdtempSync(path.join(os.tmpdir(), 'whale-persona-panel-'))
process.env.DSH_HOME = home
process.env.DSH_WHALE_CONFIG = path.join(home, 'whale-persona', 'config.json')
mkdirSync(path.dirname(process.env.DSH_WHALE_CONFIG), { recursive: true })
writeFileSync(process.env.DSH_WHALE_CONFIG, JSON.stringify({
  enabled: true,
  thinkingLanguage: 'zh-CN',
  persona: {
    enabled: true,
    selfNameFlash: '小助手', selfNamePro: '首席助手', userName: '小林',
    character: '你是{selfName}，{userName}的编程搭档。',
    contracts: [{ id: 'terse', text: '结论先行。', on: true }, { id: 'off-one', text: '这条关了', on: false }],
  },
  memory: { enabled: true, entries: [{ text: '小林喜欢先看证据' }], inbox: true },
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
  return {
    writeHead(code) { out.code = code },
    end(text) { out.body = text || '' },
    result: out,
  }
}
async function call(url, host, method) {
  const res = fakeRes()
  await route.handler({ url, method: method || 'GET', headers: { host: host || '127.0.0.1:3081' } }, res)
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
t('P9 只读（不落盘）', !!a.json && a.json.configState.exists === true)
t('P10 换档渲染', (await call('/whale-persona/api/summary?tier=pro')).json.selfName.pro === '首席助手')
t('P11 非 loopback host 拒答', (await call('/whale-persona/api/summary', 'evil.example.com:3081')).code === 403)
t('P12 换端口仍放行（不绑死 3080）', (await call('/whale-persona/api/summary', '127.0.0.1:9999')).code === 200)
t('P13 未知路径 404', (await call('/whale-persona/api/nope')).code === 404)
t('P14 POST 不误答', (await call('/whale-persona/api/summary', '127.0.0.1:3081', 'POST')).code === 404)
t('P15 origin 护栏', (await (async () => {
  const res = fakeRes()
  await route.handler({ url: '/whale-persona/api/summary', method: 'GET', headers: { host: '127.0.0.1:3081', origin: 'http://evil.example.com' } }, res)
  return { code: res.result.code }
})()).code === 403)
