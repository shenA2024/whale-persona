#!/usr/bin/env node
/**
 * 本地配置编辑器（无依赖、单文件服务）—— 给"不想手写 JSON"的用户一个直观的图形界面。
 *
 * 为什么不做成 DSH 客户端插件：那要把浏览器半身挂进宿主 profile，随宿主 UI 升级会碎，
 * 而且 ZCode 用户用不上。这里改成**独立本地页**：只绑 127.0.0.1，读写的还是同一个 config.json，
 * 预览用的还是同一套 core/ —— 两个宿主的用户都能用，且与本仓解耦。
 *
 * 用法：
 *   node scripts/ui.mjs                 # 默认 http://127.0.0.1:8787
 *   node scripts/ui.mjs --port 9000
 *   DSH_WHALE_CONFIG=<path> node scripts/ui.mjs   # 编辑指定配置文件
 *
 * 安全边界（本服务能读写你的配置文件，所以写清楚）：
 *   · 只监听 127.0.0.1，不对外；
 *   · Host 头必须匹配 127.0.0.1/localhost:<port>（防 DNS rebinding）；
 *   · 只读写**定位链解析出的那一个** config.json，不碰别的路径；
 *   · POST 必须是 application/json；没有 CORS 头，浏览器跨域拿不到结果。
 */
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULTS, mergeConfig } from '../core/defaults.js'
import { buildPersonaPrompt, buildSuffix, buildThinkingLanguage } from '../core/prompt.js'
import { captureMode } from '../core/capture.js'
import { configPath } from '../core/store.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PAGE = path.join(HERE, 'ui.html')

function argOf(name, fallback) {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const PORT = Number(argOf('--port', process.env.WHALE_UI_PORT || '8787'))
const FILE = configPath()

/** 读原始配置（保留未知键；不存在则视为空对象） */
function readRaw() {
  try {
    if (!existsSync(FILE)) return {}
    const parsed = JSON.parse(readFileSync(FILE, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return null // 坏 JSON：明确报错，不覆盖用户的文件
  }
}

/** 已知段整体替换、未知键原样保留 —— 与插件的写回纪律一致 */
function writeMerged(patch) {
  const raw = readRaw()
  if (raw === null) throw new Error('现有 config.json 不是合法 JSON，先修好它（本页不会覆盖坏文件）')
  const next = { ...raw }
  for (const key of ['enabled', 'thinkingLanguage', 'persona', 'memory']) {
    if (patch && Object.prototype.hasOwnProperty.call(patch, key)) next[key] = patch[key]
  }
  mkdirSync(path.dirname(FILE), { recursive: true })
  writeFileSync(FILE, JSON.stringify(next, null, 2) + '\n', 'utf8')
  return next
}

/** 配了却不会生效的项 —— 静默失效是配置界面最坑人的地方，这里主动点名 */
function warningsOf(cfg, model) {
  const out = []
  const p = cfg.persona || {}
  const pro = String(model || 'flash').toLowerCase().includes('pro')
  const selfName = (pro ? (p.selfNamePro || p.selfNameFlash) : p.selfNameFlash) || ''
  const texts = [p.stance, p.character].concat((p.contracts || []).map((c) => c && c.text))
  const usesPlaceholder = texts.some((t) => typeof t === 'string' && t.includes('{selfName}'))
  if (selfName && selfName !== '我' && !usesPlaceholder) {
    out.push('自称「' + selfName + '」不会出现在提示词里：它只通过 {selfName} 占位符生效 —— 写进「立场正文」或任一条契约里即可。')
  }
  const m = cfg.memory || {}
  const entries = (m.entries || []).filter((x) => x && x.on !== false && x.text)
  if (entries.length && m.enabled !== true) {
    out.push('有 ' + entries.length + ' 条手工条目，但「长期记忆」总开关是关的 —— 它们不会被注入。')
  }
  if (m.enabled === true && m.capture === 'always' && m.inbox !== false) {
    out.push("收口模式是 always：每一轮都会注入【入库纪律】（旧行为）。想按需用，改成 on-demand 并在会话里 /memory on。")
  }
  return out
}

function render(cfgRaw, capture, model, cwd) {
  const cfg = mergeConfig(cfgRaw)
  return {
    prefix: buildPersonaPrompt(cfg, model, cwd, { capture }),
    thinking: buildThinkingLanguage(cfg),
    suffix: buildSuffix(cfg, cwd),
    mode: captureMode(cfg),
    warnings: warningsOf(cfg, model),
  }
}

function json(res, code, payload) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => { data += c; if (data.length > 2_000_000) reject(new Error('body too large')) })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

const ALLOWED_HOSTS = new Set(['127.0.0.1:' + PORT, 'localhost:' + PORT, '[::1]:' + PORT])

const server = createServer(async (req, res) => {
  try {
    const host = String((req.headers && req.headers.host) || '').toLowerCase()
    if (!ALLOWED_HOSTS.has(host)) return json(res, 403, { ok: false, error: 'host not allowed' })

    const u = new URL(req.url, 'http://127.0.0.1')
    const p = u.pathname

    if (p === '/' && req.method === 'GET') {
      const html = readFileSync(PAGE, 'utf8').replace('%PORT%', String(PORT))
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      return res.end(html)
    }
    if (p === '/api/state' && req.method === 'GET') {
      const raw = readRaw()
      if (raw === null) return json(res, 200, { ok: false, error: 'config.json 不是合法 JSON', file: FILE })
      const cfg = mergeConfig(raw)
      return json(res, 200, {
        ok: true, file: FILE, exists: existsSync(FILE),
        raw, effective: cfg, defaults: DEFAULTS,
        preview: render(raw, captureMode(cfg) === 'always' || true, 'flash', process.cwd()),
      })
    }
    if (p === '/api/preview' && req.method === 'POST') {
      const ct = String((req.headers['content-type'] || '')).toLowerCase()
      if (ct.indexOf('application/json') === -1) return json(res, 415, { ok: false, error: 'content-type must be application/json' })
      const body = JSON.parse(await readBody(req))
      const capture = body.capture !== false
      return json(res, 200, { ok: true, preview: render(body.config || {}, capture, body.model || 'flash', body.cwd || process.cwd()) })
    }
    if (p === '/api/save' && req.method === 'POST') {
      const ct = String((req.headers['content-type'] || '')).toLowerCase()
      if (ct.indexOf('application/json') === -1) return json(res, 415, { ok: false, error: 'content-type must be application/json' })
      const body = JSON.parse(await readBody(req))
      const next = writeMerged(body.config || {})
      const cfg = mergeConfig(next)
      return json(res, 200, { ok: true, file: FILE, config: next, preview: render(next, captureMode(cfg) === 'always' || true, 'flash', process.cwd()) })
    }
    return json(res, 404, { ok: false, error: 'not found' })
  } catch (e) {
    return json(res, 500, { ok: false, error: String((e && e.message) || e) })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log('whale-persona 本地配置编辑器')
  console.log('  页面：http://127.0.0.1:' + PORT)
  console.log('  配置：' + FILE.replace(/\\/g, '/') + (existsSync(FILE) ? '' : '（还不存在，保存时创建）'))
  console.log('  停止：Ctrl+C')
})
