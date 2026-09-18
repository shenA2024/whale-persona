/**
 * 长期记忆收件箱（2026-09-18 建；同日升级为事件溯源式合并 + tag 相关性选择）。
 *
 * 设计要点（对照 claude-mem/mem0 的自动捕获 + 我们的「用户拍板」哲学）：
 *   ① 只追加：入库动作永远是**追加一行 JSON**，永不改写已有行——
 *      坏一行不影响其他行，损坏面为零；
 *   ② 确认流：候选在对话里列出、用户拍板后才入库，AI 不替用户决定记什么；
 *   ③ 合并语义（mem0 式 ADD/UPDATE/DELETE，闸门仍是用户确认）：
 *      事实行 {"text","at","tag"?}；操作行 {"op":"supersede","ref":"旧原文","text":"新原文","at","tag"?}
 *      替换第一条原文命中条目（视为新近，移到队尾）；{"op":"drop","ref":"旧原文","at"} 把它移出视图。
 *      读取时按行序**重放**出注入视图——物理只追加，逻辑可更新可删去；
 *      ref 命不中的操作行自然空转（不损坏任何数据）。
 *   ④ 注入上限（相关性优先）：当前项目 tag 命中 > 全局（无 tag）> 其他项目；
 *      同组超出上限保新弃旧。
 *   ⑤ 确认闸门（0.8.0，**代码强制**，不再只是提示词约束）：
 *      事实行可带 status —— 'proposed'（候选，AI 写的）/ 'confirmed'（人工确认过）/ 缺省（老格式 legacy）。
 *      注入视图只收 confirmed（老用户可把 memory.requireConfirm 关掉，放行 legacy）；
 *      proposed **永不注入**——AI 写进去也只是一条待确认候选。
 *      让候选生效的唯一动作是人工追加一行操作行：{"op":"confirm","ref":"原文","at":...}
 *      （scripts/memory.mjs confirm / 设置面板按钮）。AI 没有被授予这个动作。
 * 条目文本在读取时折叠换行——防止带 \n 的条目从「数据」列表项里伪造成新指令行。
 * 读法带 mtime 缓存（与 store 同款纪律），任何异常返回空数组。
 *
 * 同源纪律：本仓库 core/ 是唯一源；adapters/zcode/vendor/core/ 的副本由
 * scripts/sync-core.mjs 刷新，勿手改（tests/zcode-hook.mjs 的 Z7 会校验两份一致）。
 */
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { configDir } from './store.js'

/** 收件箱默认落点：与配置同目录（见 store.js 的 configDir()） */
export function inboxFile() {
  return path.join(configDir(), 'memory-inbox.jsonl')
}

/** 解析收件箱路径：config.memory.inboxPath 优先，为空则用 inboxFile() 的默认落点 */
export function resolveInbox(cfgPath) {
  const p = String(cfgPath || '').trim()
  return p ? p : inboxFile()
}

const cache = { file: '', key: '', entries: [] }

const fold = (s) => (s === undefined || s === null ? '' : String(s).trim().replace(/[\r\n]+/g, ' '))

/**
 * 条目状态。proposed = AI 写的候选（永不注入）；confirmed = 人工确认过（注入）；
 * legacy = 老格式没有 status 字段（默认不注入，用户可显式放行）。
 */
export const STATUS = { proposed: 'proposed', confirmed: 'confirmed', legacy: 'legacy' }

/** status 解析：只认 'confirmed'；'proposed' 与一切未知值都算未确认（宁可不注入，不可误注入） */
function statusOf(raw) {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (s === 'confirmed') return STATUS.confirmed
  if (s === 'proposed') return STATUS.proposed
  return STATUS.legacy
}

/** 把一行 JSON 解析为事实/操作/坏行（null）。所有文本换行一律折叠成空格（防伪指令行）。 */
function parseLine(line) {
  const s = line.trim()
  if (!s) return null
  try {
    const o = JSON.parse(s)
    if (!o || typeof o !== 'object') return null
    const op = typeof o.op === 'string' ? o.op : ''
    if (op === 'supersede') {
      const ref = fold(o.ref)
      const text = fold(o.text)
      if (!ref || !text) return null
      return { op, ref, text, at: typeof o.at === 'string' ? o.at : '', tag: fold(o.tag), status: statusOf(o.status) }
    }
    if (op === 'drop' || op === 'reject' || op === 'confirm') {
      const ref = fold(o.ref)
      if (!ref) return null
      return { op, ref, at: typeof o.at === 'string' ? o.at : '' }
    }
    if (op) return null // 未知 op：只跳过该行，不牵连整箱
    const text = fold(o.text)
    if (!text) return null
    return { op: '', text, at: typeof o.at === 'string' ? o.at : '', tag: fold(o.tag), status: statusOf(o.status) }
  } catch {
    return null // 坏行跳过，不牵连整箱
  }
}

/** 重放：按行序把操作行应用到事实行上，得到注入视图 [{text, at, tag}]（时间序旧→新）。 */
export function replayInbox(lines) {
  const entries = []
  for (const line of lines) {
    const o = parseLine(line)
    if (!o) continue
    if (!o.op) {
      entries.push({ text: o.text, at: o.at, tag: o.tag, status: o.status })
      continue
    }
    const i = entries.findIndex((e) => e.text === o.ref)
    if (i < 0) continue
    if (o.op === 'drop' || o.op === 'reject') {
      entries.splice(i, 1) // 删去：人工否决/回收，物理行仍在文件里
    } else if (o.op === 'confirm') {
      entries[i] = { ...entries[i], status: STATUS.confirmed } // 人工确认：候选转正
    } else {
      const old = entries[i]
      entries.splice(i, 1)
      // 替换后视为新近，移到队尾；没写明 status 的 supersede 沿用旧条目的确认状态（人工改写不丢确认）
      entries.push({
        text: o.text, at: o.at, tag: o.tag || old.tag || '',
        status: o.status === STATUS.legacy ? old.status : o.status,
      })
    }
  }
  return entries
}

/** 读收件箱（带 mtime 缓存）。坏行跳过；返回重放后的视图 [{text, at, tag}]（时间序旧→新） */
export function readInbox(file) {
  const f = file || inboxFile()
  try {
    const st = statSync(f)
    const key = String(st.mtimeMs) + ':' + String(st.size)
    if (key !== cache.key || cache.file !== f) {
      cache.file = f
      cache.key = key
      cache.entries = replayInbox(readFileSync(f, 'utf8').split(/\r?\n/))
    }
    return cache.entries
  } catch {
    return []
  }
}

/**
 * 注入上限下的相关性选择：当前项目 tag 命中（2）> 全局无 tag（1）> 其他项目（0）；
 * 高分组整组保留、低分组超出上限保新弃旧；返回恢复时间序（旧→新）。
 * tag 匹配用**路径段**精确比较（防『app』『src』这类短名子串放水到所有目录）。
 */
export function pickRelevant(entries, max, cwd) {
  const n = Number(max) > 0 ? Number(max) : 30
  if (entries.length <= n) return entries
  const base = String(cwd || '').replace(/\\/g, '/').toLowerCase()
  const segs = base ? base.split('/').filter(Boolean) : []
  const proj = segs.length ? segs[segs.length - 1] : ''
  const score = (e) => {
    const tag = String(e.tag || '').trim().toLowerCase()
    if (!tag) return 1
    if (proj && (tag === proj || segs.includes(tag))) return 2
    return 0
  }
  return entries
    .map((e, i) => ({ e, i, s: score(e) }))
    .sort((a, b) => (b.s - a.s) || (b.i - a.i)) // 分数降序；同分组新的在前
    .slice(0, n)
    .sort((a, b) => a.i - b.i) // 恢复时间序，注入可读
    .map((r) => r.e)
}

/**
 * 注入视图：默认只收人工确认过的条目。
 *   · confirmed 一定注入；
 *   · legacy（老格式）只在 opts.allowLegacy 时注入 —— 对应配置 memory.requireConfirm:false；
 *   · proposed 永不注入（AI 只能提议，生效必须人工确认）。
 */
export function readInjected(file, opts) {
  const allowLegacy = !!(opts && opts.allowLegacy)
  return readInbox(file).filter((e) => e.status === STATUS.confirmed || (allowLegacy && e.status === STATUS.legacy))
}

/** 待人工处理的条目（proposed 候选 + legacy 老格式），带重放视图序号，供 CLI / 面板确认或否决 */
export function readPending(file) {
  return readInbox(file)
    .map((e, index) => ({ ...e, index }))
    .filter((e) => e.status !== STATUS.confirmed)
}

/**
 * 生成"确认重放视图第 index 条"的 confirm 行（人工确认动作，AI 不许调用）。
 * 物理仍然只追加：确认不改写原行，只是追加一行操作行。
 */
export function confirmOpFor(rawLines, index) {
  const hit = replayInbox(rawLines)[Number(index)]
  if (!hit) return null
  return JSON.stringify({ op: 'confirm', ref: hit.text, at: new Date().toISOString() })
}

/** 生成"否决重放视图第 index 条"的 reject 行（人工动作） */
export function rejectOpFor(rawLines, index) {
  const hit = replayInbox(rawLines)[Number(index)]
  if (!hit) return null
  return JSON.stringify({ op: 'reject', ref: hit.text, at: new Date().toISOString() })
}

/**
 * 生成"删除重放视图第 index 条"所需的 drop 行（UI 删除/晋升用）。
 * 返回 JSON 行字符串或 null（越界）；调用方 appendFileSync 追加——
 * 不做读改写整文件（并发追加不丢行、末尾换行不丢、CRLF 不被归一）。
 * 注意：ref 按折叠后原文首匹配，两条同文条目时删的是第一条。
 */
export function dropOpFor(rawLines, index) {
  const hit = replayInbox(rawLines)[Number(index)]
  if (!hit) return null
  return JSON.stringify({ op: 'drop', ref: hit.text, at: new Date().toISOString() })
}
