#!/usr/bin/env node
/**
 * 长期记忆收件箱 · 人工确认台（0.8.0 起）
 *
 * 为什么有它：0.8.0 之前，「候选入库」的闸门只是**提示词约束**——AI 按纪律征得同意后才写盘，
 * 但代码拦不住一次精心设计的对话把长期生效的文本直接追加进 memory-inbox.jsonl（提示词注入）。
 * 现在闸门落到代码上：AI 只能写 status:"proposed" 的候选，**注入视图只认人工确认过的条目**；
 * 确认动作只在这里（或设置面板）发生 —— 这就是"人拍板"从口头约定变成机械保证的那一步。
 *
 * 用法（DSH_HOME 决定读哪份配置；默认 ~/.dsh）：
 *   node scripts/memory.mjs                 # = status：列出全部条目、标出待确认
 *   node scripts/memory.mjs confirm 2 3     # 确认第 2、3 条（序号取 status 的输出）
 *   node scripts/memory.mjs confirm all     # 确认全部待确认条目
 *   node scripts/memory.mjs reject 4        # 否决第 4 条（移出视图，物理行保留）
 *   node scripts/memory.mjs adopt           # 把老格式（没有 status 字段）条目一次性确认
 *   node scripts/memory.mjs log             # 打印原始行 + 行号（审计用）
 *   ... 追加 --dry-run 只打印将写入的行，不落盘
 *
 * 纪律：本文件是**物理只追加**的 JSONL —— 确认/否决都只是追加一行操作行，
 * 永不改写、永不删行；删行永远是安全的（坏行自动跳过）。
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { configPath, createStore } from '../core/store.js'
import { STATUS, confirmOpFor, readInbox, rejectOpFor, resolveInbox } from '../core/memoryInbox.js'

const argv = process.argv.slice(2)
const dry = argv.includes('--dry-run')
const rest = argv.filter((a) => a !== '--dry-run')
const cmd = (rest[0] || 'status').toLowerCase()
const args = rest.slice(1)

const store = createStore()
const cfg = store.get()
const mem = cfg.memory || {}
const FILE = resolveInbox(mem.inboxPath)

const MARK = { [STATUS.confirmed]: '[已确认]', [STATUS.proposed]: '[待确认]', [STATUS.legacy]: '[老格式]' }

function rawLines() {
  try {
    return readFileSync(FILE, 'utf8').split(/\r?\n/)
  } catch {
    return []
  }
}

function entries() {
  return readInbox(FILE)
}

function show() {
  console.log('配置文件：' + configPath().replace(/\\/g, '/'))
  console.log('收件箱  ：' + FILE.replace(/\\/g, '/') + (existsSync(FILE) ? '' : '  (还不存在)'))
  if (mem.enabled !== true) console.log('注意    ：配置里 memory.enabled 不是 true —— 条目不会注入。')
  if (mem.requireConfirm === false) console.log('注意    ：memory.requireConfirm = false（放行老格式条目）；proposed 候选仍然不注入。')
  const list = entries()
  if (!list.length) { console.log('\n(收件箱为空)'); return }
  console.log('\n共 ' + list.length + ' 条：')
  list.forEach((e, i) => {
    const tag = e.tag ? '  {tag: ' + e.tag + '}' : ''
    console.log('  [' + String(i).padStart(3, ' ') + '] ' + (MARK[e.status] || '[?]') + ' ' + e.text + tag)
  })
  const pending = list.filter((e) => e.status !== STATUS.confirmed)
  if (pending.length) {
    console.log('\n待确认 ' + pending.length + ' 条 —— 注入只认[已确认]。确认：node scripts/memory.mjs confirm <序号…|all>')
    const legacy = list.filter((e) => e.status === STATUS.legacy).length
    if (legacy) console.log('其中 ' + legacy + ' 条是老格式（0.8.0 之前写的，没有 status）：node scripts/memory.mjs adopt 一次性确认。')
  } else if (list.length) {
    console.log('\n全部已确认，都参与注入。')
  }
}

/** 解析序号参数：数字 / 区间 2-5 / all */
function pickIndices(list, spec) {
  const pending = list.map((e, i) => ({ e, i })).filter((x) => x.e.status !== STATUS.confirmed)
  if (spec.some((s) => /^all$/i.test(s))) return pending.map((x) => x.i)
  const out = []
  for (const s of spec) {
    if (/^\d+-\d+$/.test(s)) {
      const [a, b] = s.split('-').map(Number)
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(i)
    } else if (/^\d+$/.test(s)) {
      out.push(Number(s))
    } else {
      console.error('无法识别的序号：' + s)
      process.exit(2)
    }
  }
  return [...new Set(out)]
}

function append(lines) {
  if (!lines.length) return
  if (dry) { lines.forEach((l) => console.log('DRY: ' + l)); return }
  appendFileSync(FILE, lines.join('\n') + '\n', 'utf8')
}

function confirm(onlyLegacy) {
  const list = entries()
  const pending = list.map((e, i) => ({ e, i })).filter((x) => x.e.status !== STATUS.confirmed)
  const spec = onlyLegacy ? [] : args
  let idx = onlyLegacy
    ? pending.filter((x) => x.e.status === STATUS.legacy).map((x) => x.i)
    : pickIndices(list, spec.length ? spec : ['all'])
  if (!idx.length) { console.log('没有可确认的条目（本来就都是已确认）。'); return }
  const lines = rawLines()
  const ops = []
  for (const i of idx) {
    if (!list[i] || list[i].status === STATUS.confirmed) continue
    const op = confirmOpFor(lines, i)
    if (op) ops.push(op)
  }
  append(ops)
  console.log((dry ? '将确认 ' : '已确认 ') + ops.length + ' 条。')
  if (!dry) show()
}

function reject() {
  const list = entries()
  const lines = rawLines()
  const idx = pickIndices(list, args.length ? args : []).sort((a, b) => b - a) // 从后往前删，序号不漂
  if (!idx.length) { console.log('用法：node scripts/memory.mjs reject <序号…>'); return }
  const ops = []
  for (const i of idx) {
    const op = rejectOpFor(lines, i)
    if (op) ops.push(op)
  }
  append(ops)
  console.log((dry ? '将否决 ' : '已否决 ') + ops.length + ' 条。')
  if (!dry) show()
}

function log() {
  const lines = rawLines()
  if (!existsSync(FILE)) { console.log('(收件箱不存在)'); return }
  console.log('原始行（物理只追加；坏行会被读取时跳过）：')
  lines.forEach((l, i) => { if (l.trim()) console.log(String(i + 1).padStart(4, ' ') + '| ' + l) })
}

if (cmd === 'status' || cmd === 'list') show()
else if (cmd === 'confirm') confirm(false)
else if (cmd === 'adopt') confirm(true)
else if (cmd === 'reject' || cmd === 'drop') reject()
else if (cmd === 'log') log()
else if (cmd === 'help' || cmd === '-h' || cmd === '--help') {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*?/, '').replace(/^ \* ?/gm, ''))
} else {
  console.error('未知命令：' + cmd + '（可用：status | confirm | reject | adopt | log）')
  process.exit(2)
}
