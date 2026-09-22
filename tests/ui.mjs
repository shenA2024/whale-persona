// 本地配置编辑器（scripts/ui.mjs）—— 启动真实服务打一遍 API：读写、未知键保留、content-type 防线
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const tmp = mkdtempSync(path.join(os.tmpdir(), 'whale-persona-ui-'))
const cfgFile = path.join(tmp, 'config.json')
writeFileSync(cfgFile, JSON.stringify({ tools: { keepme: true }, persona: { userName: '小林' } }, null, 2), 'utf8')
const PORT = 8800 + Math.floor(Math.random() * 100)
const BASE = 'http://127.0.0.1:' + PORT + '/api'

const t = (name, ok) => {
  console.log(name + ':', ok)
  if (!ok) process.exitCode = 1
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'ui.mjs'), '--port', String(PORT)], {
  // DSH_HOME 必须一起隔离到 tmp：preview 会读**真实收件箱**（$DSH_HOME/whale-persona/memory-inbox.jsonl），
  // 本机只要有一条「待确认候选」，warnings 就非空、U2 就红 —— 本机红 CI 绿的隐式环境依赖（2026-09-22 实测）。
  cwd: ROOT, env: { ...process.env, DSH_WHALE_CONFIG: cfgFile, DSH_HOME: tmp }, stdio: 'ignore',
})

async function ready() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(BASE + '/state'); if (r.ok) return true } catch { /* 还没起来 */ }
    await sleep(250)
  }
  return false
}

try {
  t('U1 服务起来:', await ready())

  const state = await (await fetch(BASE + '/state')).json()
  t('U1 state 读到现有配置:', state.ok && state.exists && state.raw.persona.userName === '小林')

  const post = (p, body, ct = 'application/json') => fetch(BASE + p, { method: 'POST', headers: { 'content-type': ct }, body: typeof body === 'string' ? body : JSON.stringify(body) })

  const previewBody = { config: { enabled: true, thinkingLanguage: 'zh-CN', persona: { enabled: true, selfNameFlash: '小助手', userName: '小林', character: '你是{selfName}，{userName}的搭档。', contracts: [{ text: '结论先行。', on: true }] }, memory: { enabled: true } }, capture: true }
  const pv = await (await post('/preview', previewBody)).json()
  t('U2 预览渲染契约:', pv.ok && pv.preview.prefix.includes('工作契约') && pv.preview.prefix.includes('结论先行。'))
  t('U2 预览含自称:', pv.preview.prefix.includes('小助手'))
  t('U2 思维链语言段:', pv.preview.thinking.includes('简体中文'))
  t('U2 无提醒（配的都生效）:', pv.preview.warnings.length === 0)

  // 配了却不会生效的项要被点名（自称没进 {selfName} 占位符）
  const warnBody = { config: { enabled: true, persona: { enabled: true, selfNameFlash: '小助手', userName: '小林', contracts: [{ text: '结论先行。', on: true }] }, memory: { enabled: false, entries: [{ text: '交付用简体中文。', on: true }] } }, capture: true }
  const wn = await (await post('/preview', warnBody)).json()
  t('U2b 自称未用占位符被点名:', wn.preview.warnings.some((w) => w.includes('{selfName}')))
  t('U2b 记忆关但有条目被点名:', wn.preview.warnings.some((w) => w.includes('总开关是关的')))

  const saveBody = { config: { enabled: true, thinkingLanguage: 'zh-CN', persona: { enabled: true, selfNameFlash: '小助手' }, memory: { enabled: true, capture: 'always' } } }
  const saved = await (await post('/save', saveBody)).json()
  const onDisk = JSON.parse(readFileSync(cfgFile, 'utf8'))
  t('U3 保存成功:', saved.ok && onDisk.persona.selfNameFlash === '小助手')
  t('U3 未知键保留:', onDisk.tools && onDisk.tools.keepme === true)

  const bad = await post('/save', '{}', 'text/plain')
  t('U4 content-type 防线:', bad.status === 415)

  // Host 头要被校验（fetch 不允许改 Host，只能用裸 http）
  const { request } = await import('node:http')
  const status = await new Promise((resolve) => {
    const req = request({ host: '127.0.0.1', port: PORT, path: '/api/state', method: 'GET', headers: { Host: 'evil.example.com:' + PORT } }, (res) => { res.resume(); resolve(res.statusCode) })
    req.on('error', () => resolve(0))
    req.end()
  })
  t('U4 Host 防线:', status === 403)

  // U4b Origin 防线（0.11.0）：Origin 只要出现就必须是 loopback。
  // 为什么用裸 http：fetch 不允许改 Origin 这种被 CORS 管辖的头，而这次要的正是"外源网页发过来的样子"。
  const postRaw = (headers) => new Promise((resolve) => {
    const req = request({ host: '127.0.0.1', port: PORT, path: '/api/save', method: 'POST',
      headers: { 'content-type': 'application/json', ...headers } },
      (res) => { res.resume(); resolve(res.statusCode) })
    req.on('error', () => resolve(0))
    req.end(JSON.stringify({ config: { persona: { character: 'SEC-U4B' } } }))
  })
  // 先打外源的：此时"没被写脏"才可判（放行的两次本来就会写盘，顺序反了就判不出来）
  const evilOrigin = await postRaw({ Origin: 'https://evil.example' })
  const onDiskAfterEvil = JSON.parse(readFileSync(cfgFile, 'utf8')).persona.character
  const selfOrigin = await postRaw({ Origin: 'http://127.0.0.1:' + PORT })
  const noOrigin = await postRaw({})
  const onDiskAfterOk = JSON.parse(readFileSync(cfgFile, 'utf8')).persona.character
  t('U4b Origin 防线（外源 403 且没写脏 / 自家与裸客户端放行）:',
    evilOrigin === 403 && onDiskAfterEvil !== 'SEC-U4B' && selfOrigin === 200 && noOrigin === 200 && onDiskAfterOk === 'SEC-U4B')
  // U5 CSP（2026-09-18 审查修复）：响应头 + meta 双份、只认一次性 nonce、没有 unsafe-inline
  const pageRes = await fetch('http://127.0.0.1:' + PORT + '/')
  const html = await pageRes.text()
  const csp = pageRes.headers.get('content-security-policy') || ''
  const nonce = (/nonce-([A-Za-z0-9+/=]+)/.exec(csp) || [])[1] || ''
  t('U5 CSP 响应头带 nonce:', !!nonce && csp.includes("default-src 'none'") && csp.includes("script-src 'nonce-" + nonce + "'"))
  t('U5 CSP 无 unsafe-inline/eval:', !csp.includes('unsafe-inline') && !csp.includes('unsafe-eval'))
  t('U5 nonce 落到 script/style 标签:', html.includes('<script nonce="' + nonce + '">') && html.includes('<style nonce="' + nonce + '">'))
  t('U5 meta CSP 已替换:', html.includes('http-equiv="Content-Security-Policy"') && !html.includes('%CSP%'))
  t('U5 页面无行内 style 属性:', !/ style="/.test(html))
  const csp2 = (await fetch('http://127.0.0.1:' + PORT + '/')).headers.get('content-security-policy') || ''
  t('U5 nonce 每次请求都换:', csp2 !== csp && csp2.length > 0)

  // U6–U8（0.9.0 形象 / 语气）：本地页要能跟 core 的 appearance / tone 对齐
  t('U6 state 带语气预设（4 条）:', Array.isArray(state.tonePresets) && state.tonePresets.length === 4
    && state.tonePresets.every((p) => p && p.id && p.label && typeof p.text === 'string' && p.text.length > 20))

  const styleBody = { config: { enabled: true, persona: { userName: '小林',
    appearance: { enabled: true, text: '你是一位 20 岁的女性，身高 1.75 m。', byModel: { 'glm-5.1': '更年轻的形象。' }, note: '未知子键不要裁' },
    tone: { enabled: true, text: '语气干脆利落。', byModel: {}, ext: { keep: 1 } } } } }
  const savedStyle = await (await post('/save', styleBody)).json()
  const disk2 = JSON.parse(readFileSync(cfgFile, 'utf8'))
  const ap = (disk2.persona || {}).appearance || {}
  const tn = (disk2.persona || {}).tone || {}
  t('U7 形象/语气落盘形状正确 + 未知子键仍在 + 预览带这两段:', savedStyle.ok
    && ap.enabled === true && ap.text === '你是一位 20 岁的女性，身高 1.75 m。' && ap.byModel['glm-5.1'] === '更年轻的形象。' && ap.note === '未知子键不要裁'
    && tn.enabled === true && tn.text === '语气干脆利落。' && tn.ext && tn.ext.keep === 1
    && savedStyle.preview.prefix.includes('【形象设定】') && savedStyle.preview.prefix.includes('【回复语气】'))

  t('U8 页面模板带形象/语气卡（预设容器 + 行列表 + 加一条）:', ['aRows','tRows','tPresets','aAdd','tAdd','aText','tText']
    .every((id) => html.includes('id="' + id + '"')))
} finally {
  child.kill()
}
