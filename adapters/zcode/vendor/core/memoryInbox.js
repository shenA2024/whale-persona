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
 * 条目文本在读取时折叠换行——防止带 \n 的条目从「数据」列表项里伪造成新指令行。
 * 读法带 mtime 缓存（与 store 同款纪律），任何异常返回空数组。
 *
 * 同源纪律：本仓库 core/ 是唯一源；adapters/zcode/vendor/core/ 的副本由
 * scripts/sync-core.mjs 刷新，勿手改。内部套件版（whale-suite）与本文同步维护。
 */
import { readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function inboxFile() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'whale-suite', 'memory-inbox.jsonl')
}

/** 解析收件箱路径：config.memory.inboxPath（绝对路径）优先，空则默认 $DSH_HOME 下 */
export function resolveInbox(cfgPath) {
  const p = String(cfgPath || '').trim()
  return p ? p : inboxFile()
}

const cache = { file: '', key: '', entries: [] }

const fold = (s) => (s === undefined || s === null ? '' : String(s).trim().replace(/[\r\n]+/g, ' '))

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
      return { op, ref, text, at: typeof o.at === 'string' ? o.at : '', tag: fold(o.tag) }
    }
    if (op === 'drop') {
      const ref = fold(o.ref)
      if (!ref) return null
      return { op, ref, at: typeof o.at === 'string' ? o.at : '' }
    }
    if (op) return null // 未知 op：只跳过该行，不牵连整箱
    const text = fold(o.text)
    if (!text) return null
    return { op: '', text, at: typeof o.at === 'string' ? o.at : '', tag: fold(o.tag) }
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
      entries.push({ text: o.text, at: o.at, tag: o.tag })
      continue
    }
    const i = entries.findIndex((e) => e.text === o.ref)
    if (i < 0) continue
    if (o.op === 'drop') {
      entries.splice(i, 1)
    } else {
      const old = entries[i]
      entries.splice(i, 1)
      entries.push({ text: o.text, at: o.at, tag: o.tag || old.tag || '' }) // 替换后视为新近，移到队尾
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
