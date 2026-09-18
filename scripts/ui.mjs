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
 *   · POST 必须是 application/json；没有 CORS 头，浏览器跨域拿不到结果；
 *   · 每次请求生成一次性 nonce，CSP 同时走**响应头 + meta**（script-src/style-src 只认这个 nonce，
 *     没有 unsafe-inline）——配置里可能出现任意文本，XSS 的纵深防御不能省。
 */
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { captureMode } from '../core/capture.js'
import { configPath } from '../core/store.js'
// 读写纪律与渲染口径全部来自 core/（与 DSH 设置面板**同一套**，见 core/edit.js 的头注）
import { DEFAULTS, mergeConfig, readRawConfig, renderSections, writeMergedConfig } from '../core/edit.js'
// 语气预设也来自 core/（面板与本地页共用同一份文案，见 core/presets.js 头注）—— 页面只负责把按钮排出来
import { TONE_PRESETS } from '../core/presets.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PAGE = path.join(HERE, 'ui.html')

function argOf(name, fallback) {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const PORT = Number(argOf('--port', process.env.WHALE_UI_PORT || '8787'))
const FILE = configPath()

const readRaw = () => readRawConfig(FILE)
const writeMerged = (patch) => writeMergedConfig(patch, FILE)
const render = (cfgRaw, capture, model, cwd) => renderSections(cfgRaw, { capture, model, cwd })

function json(res, code, payload) {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  })
  res.end(JSON.stringify(payload))
}

/**
 * 模板填充：**只做纯字符串替换**，不拿正则去碰 HTML。
 * 为什么：① 正则匹配 `<script>` 这类形态会被静态扫描当成"HTML 过滤"（js/bad-tag-filter）——
 * 我们这里根本不是过滤，只是给自己的模板塞 nonce，没必要留这种形态；
 * ② 标签一旦带上属性（`<script defer>`）正则就漏，占位符写法不会。
 * 占位符缺了就抛错（宁可起不来，也不要发一个 CSP 全被封掉的空页面）。
 */
function renderPage(nonce, csp) {
  const tpl = readFileSync(PAGE, 'utf8')
  for (const ph of ['%NONCE%', '%CSP%']) {
    if (!tpl.includes(ph)) throw new Error('ui.html 模板缺少占位符 ' + ph)
  }
  return tpl
    .split('%NONCE%').join(nonce)
    .split('%CSP%').join(csp)
    .split('%PORT%').join(String(PORT))
}

/** 一次性 nonce 的 CSP：本页只用内联 script/style，所以把权限精确收到这一次响应的 nonce 上 */
function cspFor(nonce) {
  return [
    "default-src 'none'",
    "script-src 'nonce-" + nonce + "'",
    "style-src 'nonce-" + nonce + "'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
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
      const nonce = randomBytes(16).toString('base64')
      const csp = cspFor(nonce)
      const html = renderPage(nonce, csp)
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': csp,
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'cache-control': 'no-store',
      })
      return res.end(html)
    }
    if (p === '/api/state' && req.method === 'GET') {
      const raw = readRaw()
      if (raw === null) return json(res, 200, { ok: false, error: 'config.json 不是合法 JSON', file: FILE })
      const cfg = mergeConfig(raw)
      return json(res, 200, {
        ok: true, file: FILE, exists: existsSync(FILE),
        raw, effective: cfg, defaults: DEFAULTS, tonePresets: TONE_PRESETS,
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
    // 不回传异常原文（静态扫描 js/stack-trace-exposure）：细节写进跑 ui.mjs 的那个终端，
    // 客户端只拿到一句固定文案 —— 这是本机工具，但堆栈里可能带路径与配置片段，没必要过网络。
    console.error('[whale-persona ui] 请求处理失败：', e)
    return json(res, 500, { ok: false, error: '服务器内部错误（细节见运行 ui.mjs 的终端）' })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log('whale-persona 本地配置编辑器')
  console.log('  页面：http://127.0.0.1:' + PORT)
  console.log('  配置：' + FILE.replace(/\\/g, '/') + (existsSync(FILE) ? '' : '（还不存在，保存时创建）'))
  console.log('  停止：Ctrl+C')
})
