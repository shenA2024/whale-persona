/**
 * 长期记忆收件箱（2026-09-18，触发来源：shenA2024「全做」）。
 *
 * 设计要点（对照 claude-mem 的自动捕获 + 我们的「用户拍板」哲学）：
 *   ① 只追加：AI 把**用户已确认**的记忆候选逐条追加成 JSON 行（{"text","at"}），
 *      永不改写已有行——坏一行不影响其他行，损坏面为零；
 *   ② 确认流：候选在对话里列出、用户拍板后才入库，AI 不替用户决定记什么；
 *   ③ 注入有上限：与手工条目合并后保新弃旧（maxEntries），手工条目优先保留。
 * 读法带 mtime 缓存（与 store 同款纪律），任何异常返回空数组。
 */
import { readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 解析收件箱路径：config.memory.inboxPath（绝对路径）优先，空则默认 $DSH_HOME 下 */
export function resolveInbox(cfgPath) {
  const p = String(cfgPath || '').trim()
  return p ? p : inboxFile()
}

export function inboxFile() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'whale-suite', 'memory-inbox.jsonl')
}

const cache = { key: '', entries: [] }

/** 读收件箱（带 mtime 缓存）。坏行跳过；返回按文件顺序（旧→新）的 [{text, at}] */
export function readInbox(file) {
  const f = file || inboxFile()
  try {
    const st = statSync(f)
    const key = String(st.mtimeMs) + ':' + String(st.size)
    if (key !== cache.key || cache.file !== f) {
      const raw = readFileSync(f, 'utf8')
      const entries = []
      for (const line of raw.split(/\r?\n/)) {
        const s = line.trim()
        if (!s) continue
        try {
          const o = JSON.parse(s)
          if (o && typeof o.text === 'string' && o.text.trim()) {
            entries.push({ text: o.text.trim(), at: typeof o.at === 'string' ? o.at : '' })
          }
        } catch { /* 坏行跳过，不牵连整箱 */ }
      }
      cache.file = f
      cache.key = key
      cache.entries = entries
    }
    return cache.entries
  } catch {
    return []
  }
}

/** 从收件箱原始 JSONL 行里删掉第 index 条（UI 删除用）：返回重写后的行数组 */
export function removeInboxLine(rawLines, index) {
  // index 对应 readInbox 的可见条目序号：重新扫一遍，跳过坏行计数
  const kept = []
  let seen = -1
  for (const line of rawLines) {
    const s = line.trim()
    let isEntry = false
    if (s) {
      try {
        const o = JSON.parse(s)
        isEntry = !!(o && typeof o.text === 'string' && o.text.trim())
      } catch { isEntry = false }
    }
    if (isEntry) {
      seen += 1
      if (seen === index) continue // 删这一条
    }
    kept.push(line)
  }
  return kept
}
