/**
 * 极简 JSONL 追加日志（本仓零依赖策略：不引任何宿主包，只用 node 内置）。
 *
 * 用途：条件反射每次动作写一行 —— 回答"刚才为什么那样回答 / 这一步为什么少了这些工具"。
 * 纪律：**日志永远不许影响会话** —— 目录建不出来、盘满、权限不够，全部安静吞掉。
 * 体积上限：超过 maxBytes 之后不再追加（避免长跑会话把日志写到天上去），不清空、不搬移。
 */
import { appendFileSync, mkdirSync, statSync } from 'node:fs'
import path from 'node:path'

export function makeJsonlLog(file, maxBytes = 2 * 1024 * 1024) {
  return function log(row) {
    try {
      if (statSync(file).size > maxBytes) return
    } catch { /* 文件还不存在：继续走追加（appendFile 会建） */ }
    try {
      mkdirSync(path.dirname(file), { recursive: true })
      appendFileSync(file, JSON.stringify(Object.assign({ t: new Date().toISOString() }, row)) + '\n', 'utf8')
    } catch { /* 写不进去就算了：日志不是会话的一部分 */ }
  }
}
