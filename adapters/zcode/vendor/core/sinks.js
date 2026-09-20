/**
 * 沉降路由（0.13.0）——把「AI 提议 → 人确认」的闸门从人设记忆推广到**任何可追加的资产**。
 *
 * 问题：memory-inbox.jsonl 的代码级确认闸门原先只服务「人设长期记忆」。而用户真正每天在做的
 * 沉淀（坑卡、思想回填、去重笔记）全靠提示词里的君子协定——"别忘了写坑卡"这种话，恰恰是本插件
 * 存在的理由所要消灭的东西。本模块让同一条闸门覆盖它们：
 *   ① AI 只能写 status:"proposed" 的候选（可带 kind）；
 *   ② 人工确认（scripts/memory.mjs confirm）那一刻，条目按 kind 路由**只追加式**落进目标文件；
 *   ③ 落盘记录写 sink-log.jsonl，重复执行不重复写（幂等）；
 *   ④ kind 为 'memory'（缺省）的条目照旧注入提示词，不落盘 —— 老行为逐字节不变。
 *
 * 纪律（与 core/ 其余模块同一套）：
 *   · 物理只追加，永不改写目标文件里的已有内容；
 *   · 任何异常都降级成「没落盘 + 报告」，绝不抛错、绝不半写（先写日志后 drop 的顺序见 sinkConfirmed）；
 *   · 本模块只被**人工动作**调用（CLI / 面板），AI 侧没有任何入口。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { configDir } from './store.js'
// 单向依赖：memoryInbox 不认识 sinks（注入型/沉降型的判据都收在 memoryInbox 的 kindOf），
// 所以这里只能从它取常量与归一化，绝不反向 import —— 否则就是循环依赖。
import { MEMORY_KIND, kindOf, normKind, replayInbox } from './memoryInbox.js'

export { MEMORY_KIND }

/** 沉降日志落点：memory.sinkLog 优先，为空则配置目录下的 sink-log.jsonl */
export function sinkLogFile(mem) {
  try {
    const p = String((mem && mem.sinkLog) || '').trim()
    if (p) return path.isAbsolute(p) ? p : path.join(configDir(), p)
    return path.join(configDir(), 'sink-log.jsonl')
  } catch {
    return ''
  }
}

/** 归一化 kind（与 memoryInbox 同一套规则，避免两处实现漂移） */
const foldKind = (k) => normKind(k)

/**
 * 归一化路由表：{ kind: { path, format, template, header, createParents } }。
 * 只认有 path 的条目；坏形状一律丢弃（宁可"没有路由"，不可"写错地方"）。
 * kind='memory' 的键显式忽略——那是注入型，不进沉降。
 */
export function sinkRoutes(mem) {
  const out = {}
  try {
    const raw = mem && mem.sinks
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
    for (const key of Object.keys(raw)) {
      const kind = foldKind(key)
      if (!kind || kind === MEMORY_KIND) continue
      const r = raw[key]
      if (!r || typeof r !== 'object' || Array.isArray(r)) continue
      const p = typeof r.path === 'string' ? r.path.trim() : ''
      if (!p) continue
      const format = ['md', 'plain', 'jsonl'].includes(String(r.format || '').trim().toLowerCase())
        ? String(r.format).trim().toLowerCase() : 'md'
      out[kind] = {
        kind,
        path: path.isAbsolute(p) ? p : path.join(configDir(), p),
        rawPath: p,
        format,
        template: typeof r.template === 'string' && r.template ? r.template : '',
        header: typeof r.header === 'string' ? r.header : '',
        createParents: r.createParents !== false,
      }
    }
  } catch { /* 坏配置 = 没有路由 */ }
  return out
}

const day = (at) => {
  const s = String(at || '')
  const t = s ? Date.parse(s) : NaN
  const d = Number.isFinite(t) ? new Date(t) : new Date()
  return d.toISOString().slice(0, 10)
}

/** 按模板渲染一条沉降文本（不含换行）。占位符：{text} {date} {kind} {tag} {source} */
export function renderSinkText(route, entry, opts) {
  const e = entry || {}
  const source = String((opts && opts.source) || 'memory.mjs')
  const vars = {
    text: String(e.text == null ? '' : e.text).replace(/[\r\n]+/g, ' '),
    date: day(e.at),
    kind: foldKind(e.kind) || MEMORY_KIND,
    tag: String(e.tag || ''),
    source,
  }
  if (route.format === 'jsonl') {
    return JSON.stringify({ text: vars.text, kind: vars.kind, tag: vars.tag || undefined, at: e.at || new Date().toISOString(), source })
  }
  if (route.format === 'plain') {
    const tpl = route.template || '{text}'
    return tpl.replace(/\{(text|date|kind|tag|source)\}/g, (_, k) => vars[k])
  }
  const tpl = route.template || '- {text}（{date}）'
  return tpl.replace(/\{(text|date|kind|tag|source)\}/g, (_, k) => vars[k])
}

/** 读沉降日志（幂等判据 + 审计）。坏行跳过，读不到返回空数组 */
export function readSinkLog(mem) {
  const f = sinkLogFile(mem)
  if (!f || !existsSync(f)) return []
  try {
    const out = []
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const s = line.trim()
      if (!s) continue
      try {
        const o = JSON.parse(s)
        if (o && typeof o === 'object') out.push(o)
      } catch { /* 坏行跳过 */ }
    }
    return out
  } catch {
    return []
  }
}

const keyOf = (kind, text, file) => foldKind(kind) + '\u0000' + String(text) + '\u0000' + String(file).toLowerCase()

function appendLine(route, text) {
  const dir = path.dirname(route.path)
  const fresh = !existsSync(route.path)
  if (fresh && route.createParents) mkdirSync(dir, { recursive: true })
  const prefix = fresh && route.header ? route.header.replace(/\r?\n?$/, '\n') : ''
  const body = prefix + text + '\n'
  appendFileSync(route.path, body, 'utf8')
  return body.length
}

/**
 * 沉降一条**已确认**条目。返回 { ok, skipped, path, bytes, error }。
 * 幂等：同 kind + 同正文 + 同目标已在日志里 → skipped（不重复写）。
 */
export function sinkEntry(mem, entry, opts) {
  try {
    const kind = foldKind(entry && entry.kind) || MEMORY_KIND
    if (kind === MEMORY_KIND) return { ok: true, skipped: true, reason: 'memory-kind' }
    const routes = sinkRoutes(mem)
    const route = routes[kind]
    if (!route) return { ok: false, error: 'no-route', kind }
    const text = renderSinkText(route, entry, opts)
    if (!text.trim()) return { ok: false, error: 'empty-text', kind }
    const key = keyOf(kind, text, route.path)
    const seen = readSinkLog(mem).some((r) => keyOf(r.kind, r.line, r.path) === key)
    if (seen) return { ok: true, skipped: true, reason: 'already-sunk', path: route.path }
    const bytes = appendLine(route, text)
    const log = sinkLogFile(mem)
    try {
      mkdirSync(path.dirname(log), { recursive: true })
      appendFileSync(log, JSON.stringify({
        at: new Date().toISOString(), kind, path: route.path, format: route.format,
        line: text, bytes, source: String((opts && opts.source) || 'memory.mjs'),
      }) + '\n', 'utf8')
    } catch { /* 日志写不了：内容已经落了，不因此报失败 */ }
    return { ok: true, skipped: false, path: route.path, bytes, kind }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
}

/**
 * 批量沉降「刚刚被确认的」条目（人工动作之后调用）。
 * @param mem  memory 配置段
 * @param rawLines 收件箱原始行（确认动作已写入，这里按 index 取重放视图）
 * @param indices 要沉降的重放视图序号
 * @returns { sunk, skipped, noRoute, errors, dropLines }
 *   dropLines = 沉降成功后应追加的 drop 行（收件箱是队列：入库即出队），由调用方统一追加。
 */
export function sinkConfirmed(mem, rawLines, indices, opts) {
  const res = { sunk: [], skipped: [], noRoute: [], errors: [], dropLines: [] }
  try {
    const list = replayInbox(rawLines || [])
    for (const i of indices || []) {
      const e = list[Number(i)]
      if (!e) continue
      const kind = foldKind(e.kind) || MEMORY_KIND
      if (kind === MEMORY_KIND) continue
      const r = sinkEntry(mem, e, opts)
      if (r.ok && r.skipped) res.skipped.push({ index: Number(i), kind, path: r.path || '', reason: r.reason })
      else if (r.ok) {
        res.sunk.push({ index: Number(i), kind, path: r.path, bytes: r.bytes, text: e.text })
        res.dropLines.push(JSON.stringify({ op: 'drop', ref: e.text, at: new Date().toISOString() }))
      } else if (r.error === 'no-route') res.noRoute.push({ index: Number(i), kind, text: e.text })
      else res.errors.push({ index: Number(i), kind, error: r.error })
    }
  } catch (e) {
    res.errors.push({ error: String((e && e.message) || e) })
  }
  return res
}

/** 目标文件当前字节数（面板展示用；不存在返回 0） */
export function sinkFileBytes(route) {
  try {
    return statSync(route.path).size
  } catch {
    return 0
  }
}
