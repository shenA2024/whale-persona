/**
 * @shenA2024/whale-persona-ui —— 设置面板（宿主半身）
 *
 * 它只做一件事：把「人设引擎此刻实际会注入什么」端给设置页，让用户看得见。
 * 只读 —— 写配置仍然只有两条路：本地编辑器（scripts/ui.mjs）或让 AI 改。
 *
 * 挂载位必须是 **profile patch 栈**（UI 插件进不了 agent preset 平面）；
 * 人设本体（@shenA2024/whale-persona 的三个段）必须在 **agent preset 平面**。
 * 挂错平面的后果不是「这个插件失效」，而是整个插件树加载失败、DSH 起不来
 * （prompt section "deployment:persona-prefix" is already registered）。
 *
 * 与渲染的唯一源一致：三段文本全部来自 core/，与运行期注入**同一套代码**，
 * 不是面板自己拼的近似值。
 */
import { existsSync, statSync } from 'node:fs'
import { configPath, createStore } from '../../core/store.js'
import { buildPersonaPrompt, buildSuffix, buildThinkingLanguage } from '../../core/prompt.js'
import { captureMode } from '../../core/capture.js'
import { readInbox, resolveInbox } from '../../core/memoryInbox.js'
import { selfNameOf } from '../../core/render.js'
// 语气预设的文案只有 core/presets.js 一份：面板（/summary）与本地编辑页都从这里取，两处各写一份必然漂移
import { TONE_PRESETS } from '../../core/presets.js'
// 人设预设库（0.10.0）：预设 = 可切换 / 可分享的人格文件；酒馆卡映射单独一层
import {
  PRESET_SPEC, applyPresetToFile, deletePreset as removePreset, listPresets, loadPreset,
  normalizePreset, presetsDir, presetFromConfig, safeId as safePresetId, savePreset, skippedPresets,
} from '../../core/presetStore.js'
import { detectCard, fromTavern, toTavern } from '../../core/tavernCard.js'
// 宿主上一次真实注入用的模型 id：界面上的模型显示名通常不是它（见 core/lastModel.js 头注）
import { readLastModel } from '../../core/lastModel.js'
// 读写纪律与本地编辑器页（scripts/ui.mjs）**同一套**：只替换已知段、未知键保留、坏 JSON 拒写
import { DEFAULTS, mergeConfig, readRawConfig, renderSections, writeMergedConfig } from '../../core/edit.js'
// 条件反射层（reflex，2026-09-20 并入人设插件）：本路由只做两件事 —— 报状态、试命中。
// 规则文件在用户自己那边，**本包不写规则**；写规则走"让 AI 改文件 + scripts/reflex.mjs 体检"那条路。
import { reflexState, reflexTest } from '../dsh/reflex/index.js'

export const name = '@shenA2024/whale-persona-ui'

/** 只依赖宿主 webServer：开 HTTP 路由给浏览器半身用 */
export const inject = ['webServer']

const API_PATH = '/whale-persona/api'

/** 面板里显示的 flash / pro 两档代表模型（与 core/render.js 的 tierOf 判定一致） */
const TIER_MODEL = { flash: 'deepseek-v4-flash', pro: 'deepseek-v4-pro' }

/**
 * 本机护栏：只有 loopback 的请求能读。
 * 刻意**不**绑定部署端口 —— 端口由宿主决定（dsh --port 可以随时换），
 * 写死端口会让面板在换端口后 403（本机实测过：3081 上硬编码 3080 的旧写法直接拒答）。
 */
function guard(req) {
  const host = String((req.headers && req.headers.host) || '').toLowerCase()
  if (!isLoopbackHost(host)) return { code: 403, error: 'host not allowed' }
  const origin = req.headers && req.headers.origin
  if (origin !== undefined && origin !== null && String(origin) !== '' && String(origin) !== 'null') {
    let hostname = ''
    try { hostname = new URL(String(origin)).hostname } catch { return { code: 403, error: 'origin not allowed' } }
    if (!isLoopbackHost(hostname)) return { code: 403, error: 'origin not allowed' }
  }
  return null
}

function isLoopbackHost(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return false
  const hostname = raw.startsWith('[') ? raw.slice(1, raw.indexOf(']'))
    : (raw.includes(':') ? raw.slice(0, raw.lastIndexOf(':')) : raw)
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
}

function editorInfo() {
  const port = Number(process.env.DSH_WHALE_UI_PORT) > 0 ? Number(process.env.DSH_WHALE_UI_PORT) : 8787
  return { url: 'http://127.0.0.1:' + port, port }
}

/** 本地编辑器在不在跑（400ms 超时；失败一律当没跑，不阻塞面板） */
async function editorRunning(url) {
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 400)
    const res = await fetch(url + '/api/config', { signal: ctl.signal })
    clearTimeout(t)
    return !!res && res.status < 500
  } catch {
    return false
  }
}

/** 面板档位 → 代表模型 id（写路由与读路由共用同一套换算） */
function modelForPanel(query) {
  const wanted = String((query && query.get ? query.get('tier') : query) || '').toLowerCase()
  return TIER_MODEL[wanted === 'pro' ? 'pro' : 'flash']
}

/** 收请求体（限 2MB，防呆） */
function readBody(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => { data += c; if (data.length > limit) reject(new Error('body too large')) })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function fileState(file) {
  try {
    const st = statSync(file)
    return { exists: true, bytes: st.size, mtimeMs: st.mtimeMs }
  } catch {
    return { exists: false, bytes: 0, mtimeMs: 0 }
  }
}

/** 面板正文：与运行期同源的三段 + 配置概览 */
function buildSummary(query) {
  const file = configPath()
  const state = fileState(file)
  const store = createStore()
  const cfg = store.get()

  const wanted = String(query.get('tier') || '').toLowerCase()
  const tier = wanted === 'pro' ? 'pro' : 'flash'
  const model = TIER_MODEL[tier]
  // 面板没有会话，拿不到本会话的 /memory 开关：只把 capture:'always'（每轮注入）算作激活
  const capture = captureMode(cfg) === 'always'
  const cwdLabel = '<当前工作目录>'

  // 三段与告警走 core/edit.js 的唯一渲染口径（保存路由同一套），不再本地各算一份
  const raw = readRawConfig(file)
  const rendered = renderSections(raw === null ? {} : raw, { model, cwd: cwdLabel, capture })
  const sections = { prefix: rendered.prefix, thinking: rendered.thinking, suffix: rendered.suffix }

  const persona = (cfg && cfg.persona) || {}
  const contracts = Array.isArray(persona.contracts)
    ? persona.contracts.map((c, i) => ({
      id: typeof c.id === 'string' && c.id ? c.id : 'contract-' + (i + 1),
      text: typeof c.text === 'string' ? c.text : '',
      on: c.on !== false,
    })).filter((c) => c.text)
    : []

  const memory = (cfg && cfg.memory) || {}
  const manual = Array.isArray(memory.entries) ? memory.entries.filter((e) => e && typeof e.text === 'string') : []
  const inbox = memory.inbox === false ? [] : readInbox(resolveInbox(memory.inboxPath))
  const maxEntries = Number(memory.maxEntries) > 0 ? Number(memory.maxEntries) : 30

  return {
    ok: true,
    tier,
    model,
    // 表单要用：磁盘上的原始对象（含未知键，保存时整体回写）、出厂默认值、静默失效告警
    raw: raw === null ? null : raw,
    configValid: raw !== null,

    defaults: DEFAULTS,
    warnings: rendered.warnings,
    configPath: file,
    configState: state,
    enabled: cfg.enabled !== false,
    thinkingLanguage: typeof cfg.thinkingLanguage === 'string' ? cfg.thinkingLanguage : 'off',
    selfName: { flash: selfNameOf(cfg, 'flash'), pro: selfNameOf(cfg, 'pro') },
    // 面板展示用：档位标签 + 判定规则 + 按模型指定自称的表（前端不再显示具体模型 id，避免"GLM 用户看到 deepseek"）
    tierLabel: tier === 'pro' ? 'pro 档' : 'flash 档',
    tierRule: '档位由会话的模型名判定：名字含 "pro" 算 pro 档，其余算 flash 档。「按模型指定自称」的条目优先于档位。',
    // 「按模型」表里的关键词该写什么 —— 就写这个 id（界面上的模型显示名往往不是它）
    lastModel: readLastModel(),
    selfNameByModel: (persona.selfNameByModel && typeof persona.selfNameByModel === 'object' && !Array.isArray(persona.selfNameByModel)) ? persona.selfNameByModel : {},
    // 语气预设（0.9.0）：形象 / 语气的按模型覆盖表随 raw / defaults 下发，前端不必再问一次；
    // 预设本身只是「一键填进 tone.text 的现成文案」（core/presets.js）—— 面板点一下填进输入框，用户可继续手改
    tonePresets: TONE_PRESETS,
    userName: typeof persona.userName === 'string' ? persona.userName : '',
    contracts,
    memory: {
      enabled: memory.enabled === true,
      inbox: memory.inbox !== false,
      capture: captureMode(cfg),
      captureNow: capture,
      manualEntries: manual.length,
      maxEntries,
      inboxLines: inbox.length,
      // 与 core/edit.js 的提示同一口径：待确认候选数（横幅说"K 条待确认候选"，卡片说"M 行 · 待确认 K 条"）
      inboxPending: inbox.filter((e) => e && e.status === 'proposed').length,
      recent: inbox.slice(-5).map((e) => ({ text: e.text, tag: e.tag || '' })),
    },
    sections,
  }
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API_PATH,
    handler: async (req, res) => {
      const send = (code, payload) => {
        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(payload))
      }
      try {
        const blocked = guard(req)
        if (blocked) return send(blocked.code, { ok: false, error: blocked.error })

        const url = new URL(req.url, 'http://127.0.0.1')
        if (url.pathname === API_PATH + '/summary' && req.method === 'GET') {
          const summary = buildSummary(url.searchParams)
          const editor = editorInfo()
          summary.editor = { url: editor.url, port: editor.port, running: await editorRunning(editor.url) }
          return send(200, summary)
        }
        // ── 保存（唯一写入口）──────────────────────────────────────────────────
        // 用户在设置面板里自己改配置：与本地编辑页同一条纪律 —— 整体读改写、只替换已知段、
        // 未知键原样保留；现有文件是坏 JSON 时拒绝写入（409），绝不覆盖用户的数据。
        if (url.pathname === API_PATH + '/config' && req.method === 'POST') {
          const ct = String((req.headers && req.headers['content-type']) || '').toLowerCase()
          if (ct.indexOf('application/json') === -1) return send(415, { ok: false, error: 'content-type must be application/json' })
          let body = null
          try { body = JSON.parse(await readBody(req)) } catch (e) {
            return send(400, { ok: false, error: 'body is not valid JSON: ' + String((e && e.message) || e) })
          }
          const patch = body && body.config && typeof body.config === 'object' && !Array.isArray(body.config) ? body.config : null
          if (!patch) return send(400, { ok: false, error: 'config object required' })
          if (readRawConfig(configPath()) === null) {
            return send(409, { ok: false, error: '现有 config.json 不是合法 JSON，先修好它（设置面板不会覆盖坏文件）' })
          }
          let next = null
          try { next = writeMergedConfig(patch, configPath()) } catch (e) {
            return send(409, { ok: false, error: String((e && e.message) || e) })
          }
          const model = modelForPanel(url.searchParams)
          return send(200, {
            ok: true,
            configPath: configPath(),
            config: next,
            effective: mergeConfig(next),
            preview: renderSections(next, { model, cwd: '<当前工作目录>' }),
            savedAt: new Date().toISOString(),
          })
        }
        // ── 人设预设库（0.10.0）────────────────────────────────────────────
        // 读：列表 / 导出；写：应用 / 另存 / 删除 / 导入。
        // 导出只回 JSON（不写盘、不生成下载流），由浏览器侧自己存文件。
        if (url.pathname === API_PATH + '/presets' && req.method === 'GET') {
          return send(200, { ok: true, dir: presetsDir(), configPath: configPath(), presets: listPresets(), skipped: skippedPresets() })
        }
        if (url.pathname === API_PATH + '/presets/export' && req.method === 'GET') {
          const p = loadPreset(url.searchParams.get('id'))
          if (!p) return send(404, { ok: false, error: 'preset not found' })
          const wantTavern = String(url.searchParams.get('format') || '') === 'tavern'
          const json = wantTavern
            ? toTavern(p)
            : {
              spec: PRESET_SPEC, id: p.id, label: p.label, description: p.description,
              author: p.author, tags: p.tags, thinkingLanguage: p.thinkingLanguage, persona: p.persona,
            }
          return send(200, { ok: true, id: p.id, format: wantTavern ? 'tavern' : 'whale', json })
        }
        if (url.pathname.indexOf(API_PATH + '/presets/') === 0 && req.method === 'POST') {
          const ct = String((req.headers && req.headers['content-type']) || '').toLowerCase()
          if (ct.indexOf('application/json') === -1) return send(415, { ok: false, error: 'content-type must be application/json' })
          let body = null
          try { body = JSON.parse(await readBody(req)) } catch (e) {
            return send(400, { ok: false, error: 'body is not valid JSON: ' + String((e && e.message) || e) })
          }
          const action = url.pathname.slice((API_PATH + '/presets/').length)

          if (action === 'apply') {
            const preset = loadPreset(body && body.id)
            if (!preset) return send(404, { ok: false, error: 'preset not found' })
            const r = applyPresetToFile(preset)
            if (!r.ok) return send(409, { ok: false, error: r.error })
            const model = modelForPanel(url.searchParams)
            const next = readRawConfig(configPath())
            return send(200, {
              ok: true,
              applied: preset.id,
              autosave: r.autosave ? 'autosave' : '',
              presets: listPresets(),
              config: next === null ? null : next,
              preview: renderSections(next === null ? {} : next, { model, cwd: '<当前工作目录>' }),
            })
          }

          if (action === 'save') {
            const id = safePresetId(body && body.id)
            if (!id) return send(400, { ok: false, error: 'id 只能字母数字_-（作为文件名）' })
            const cfg = createStore().get()
            const file = savePreset(presetFromConfig(cfg, {
              id, label: (body && body.label) || id, description: (body && body.description) || '',
            }))
            if (!file) return send(500, { ok: false, error: 'save failed' })
            return send(200, { ok: true, id, file, presets: listPresets() })
          }

          if (action === 'delete') {
            const id = safePresetId(body && body.id)
            if (!id) return send(400, { ok: false, error: 'id required' })
            return send(200, { ok: true, id, deleted: removePreset(id), presets: listPresets() })
          }

          if (action === 'import') {
            // 文本进来就行：酒馆卡（v1/v2 JSON）或本引擎预设都能认；认不出**不猜**
            let raw = body && body.json
            if (typeof raw === 'string') {
              try { raw = JSON.parse(raw) } catch (e) {
                return send(400, { ok: false, error: '不是合法 JSON：' + String((e && e.message) || e) + '（酒馆的 PNG 卡请先在酒馆里导出成 JSON）' })
              }
            }
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return send(400, { ok: false, error: '需要一个 JSON 对象' })
            const kind = detectCard(raw)
            let preset = null
            let report = { mapped: [], unmapped: [], notes: [] }
            if (kind === 'tavern-v2' || kind === 'tavern-v1') {
              const imp = fromTavern(raw)
              if (!imp) return send(400, { ok: false, error: '这张卡读不出来' })
              preset = imp.preset
              report = { mapped: imp.mapped, unmapped: imp.unmapped, notes: imp.notes, kind }
            } else if (kind === 'whale-preset') {
              preset = normalizePreset(raw, 'imported')
              report = { mapped: ['whale-persona 预设（' + (raw.spec || '早期格式') + '）'], unmapped: [], notes: [], kind }
            } else {
              return send(400, { ok: false, error: '认不出这是哪种卡（既不是酒馆 v1/v2 角色卡，也不是本引擎预设）' })
            }
            let id = safePresetId(preset.id) || 'imported'
            let n = 1
            while (loadPreset(id)) { n += 1; id = (safePresetId(preset.id) || 'imported') + '-' + n }
            preset.id = id
            const file = savePreset(preset)
            if (!file) return send(500, { ok: false, error: 'write failed' })
            return send(200, { ok: true, id, file, report, presets: listPresets() })
          }

          return send(404, { ok: false, error: 'unknown presets action: ' + action })
        }
        // ── 条件反射（reflex）：只读状态 + 试命中 ────────────────────────────────
        if (url.pathname === API_PATH + '/reflex/state' && req.method === 'GET') {
          try { return send(200, reflexState()) } catch (e) { return send(200, { ok: false, error: String((e && e.message) || e) }) }
        }
        if (url.pathname === API_PATH + '/reflex/test' && req.method === 'GET') {
          // 不写档位 = 跨档试（flash → pro → 其它 各判一次）：规则按档位分写时，
          // 只试一个档位会把"其实会命中"说成"不会命中"——面板不许说假话。
          const q = url.searchParams.get('q') || ''
          const tier = url.searchParams.get('tier') || ''
          try { return send(200, { ok: true, query: q, ...reflexTest(q, tier, '') }) } catch (e) { return send(200, { ok: false, error: String((e && e.message) || e) }) }
        }
        if (url.pathname === API_PATH + '/health' && req.method === 'GET') {
          return send(200, { ok: true, exists: existsSync(configPath()) })
        }
        return send(404, { ok: false, error: 'not found' })
      } catch (e) {
        // 面板坏掉不能连累设置页：永远回一个可读的 JSON
        return send(500, { ok: false, error: String((e && e.message) || e) })
      }
    },
  }), 'whale-persona-ui: api route')
}
