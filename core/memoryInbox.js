/**
 * 长期记忆收件箱（2026-09-18，触发来源：shenA2024「全做」）。
 *
 * 设计要点（对照 claude-mem 的自动捕获 + 我们的「用户拍板」哲学）：
 *   ① 只追加：AI 把**用户已确认**的记忆候选逐条追加成 JSON 行（{"text","at"}），
 *      永不改写已有行——坏一行不影响其他行，损坏面为零；
 *   ② 确认流：候选在对话里列出、用户拍板后才入库，AI 不替用户决定记什么；
 *   ③ 注入有上限：保新弃旧（maxEntries）。
 * 读法带 mtime 缓存（与 store 同款纪律），任何异常返回空数组。
 * 条目文本在读取时折叠换行——防止带 \n 的条目从「数据」列表项里伪造成新指令行。
 */
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { dshHome } from './store.js'

function inboxFile() {
  return path.join(dshHome(), 'whale-suite', 'memory-inbox.jsonl')
}

/** 解析收件箱路径：config.memory.inboxPath（绝对路径）优先，空则默认 $DSH_HOME 下 */
export function resolveInbox(cfgPath) {
  const p = String(cfgPath || '').trim()
  return p ? p : inboxFile()
}

const cache = { file: '', key: '', entries: [] }

/** 读收件箱（带 mtime 缓存）。坏行跳过；返回按文件顺序（旧→新）的 [{text, at}] */
export function readInbox(file) {
  const f = file || inboxFile()
  try {
    const st = statSync(f)
    const key = String(st.mtimeMs) + ':' + String(st.size)
    if (key !== cache.key || cache.file !== f) {
      const entries = []
      for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
        const s = line.trim()
        if (!s) continue
        try {
          const o = JSON.parse(s)
          if (o && typeof o.text === 'string' && o.text.trim()) {
            entries.push({ text: o.text.trim().replace(/[\r\n]+/g, ' '), at: typeof o.at === 'string' ? o.at : '' })
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
