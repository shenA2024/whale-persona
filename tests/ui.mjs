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
  cwd: ROOT, env: { ...process.env, DSH_WHALE_CONFIG: cfgFile }, stdio: 'ignore',
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
} finally {
  child.kill()
}
