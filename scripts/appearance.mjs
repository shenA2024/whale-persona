#!/usr/bin/env node
/**
 * 形象卡 · 读全文与体检（0.18.0）
 *
 * 为什么有它：形象卡默认**只注入一行摘要**（`appearance.cards[].brief`），长文（`detail`）与
 * 照片路径（`media`）留在配置里按需读 —— 与记忆分层的【记忆目录】同一套设计：提示词里
 * 只有"有什么、去哪读"，正文不搬进去。本命令就是那个"去哪读"。
 *
 * 用法（DSH_HOME 决定读哪份配置；默认 ~/.dsh）：
 *   node scripts/appearance.mjs                 # = list：列出全部形象卡与开关状态
 *   node scripts/appearance.mjs list            # 同上
 *   node scripts/appearance.mjs show xushi      # 读一张卡的全文（摘要 + 正文 + 照片路径）
 *   node scripts/appearance.mjs media xushi     # 只打照片路径（每行一条，方便直接喂给看图工具）
 *   node scripts/appearance.mjs check           # 体检：重复 id / 空卡 / 路径不存在 / 填了不会注入
 *   ... 追加 --config <file> 读指定的 config.json（否则走 $DSH_WHALE_CONFIG 或默认位置）
 *
 * 纪律：本命令**只读**，不改配置、不写盘（卡片由用户手改 config.json，或将来由界面管理）。
 */
import { existsSync } from 'node:fs'
import { CARD_WHO } from '../core/defaults.js'
import { readRawConfig } from '../core/edit.js'
import { configPath, createStore } from '../core/store.js'
import { cardBody, cardHasHiddenBody } from '../core/render.js'

let args = process.argv.slice(2)
const ci = args.indexOf('--config')
if (ci >= 0) {
  const f = args[ci + 1]
  if (f) process.env.DSH_WHALE_CONFIG = f
  args = args.filter((_, i) => i !== ci && i !== ci + 1)
}
const cmd = (args[0] || 'list').toLowerCase()
const rest = args.slice(1)

const cfgFile = configPath()
const store = createStore()
const cfg = store.get()
const ap = (cfg.persona && cfg.persona.appearance) || {}
const cards = Array.isArray(ap.cards) ? ap.cards : []
const userName = (cfg.persona && cfg.persona.userName) || '用户'
const p = (s) => String(s == null ? '' : s).replace(/\\/g, '/')

/** 缩略：多行正文压成一行（列表用），超长截断 */
const flat = (s, n) => p(String(s == null ? '' : s).replace(/\s+/g, ' ').trim()).slice(0, n)

function header() {
  console.log('配置文件：' + p(cfgFile) + (existsSync(cfgFile) ? '' : '  (还不存在)'))
  console.log('形象段  ：' + (ap.enabled === true ? '开（appearance.enabled = true）' : '关（appearance.enabled 不是 true —— 形象卡不会注入）'))
  const self = cards.find((c) => c.who === 'self')
  if (self) console.log('自己的形象：来自卡 [' + self.id + ']（覆盖 appearance.text）')
  else console.log('自己的形象：来自 appearance.text（' + String((ap.text || '').length) + ' 字）')
  console.log('形象目录：' + (ap.index === false ? '关（appearance.index = false）' : '开'));
}

function list() {
  header()
  if (!cards.length) {
    console.log('卡片    ：0 张 —— 这一层还是空白的（config 里 persona.appearance.cards 为 []）')
    console.log('读法    ：在 persona.appearance.cards 里加一张卡，字段 id / who / title / brief / detail / media / auto / expand。')
    return
  }
  console.log('卡片    ：' + cards.length + ' 张')
  for (const c of cards) {
    const flags = 'who=' + c.who + ' auto=' + (c.auto ? 'on ' : 'off') + ' expand=' + c.expand
      + (cardHasHiddenBody(c) ? ' 有正文未展开' : '')
    console.log('  [' + c.id + '] ' + flags)
    console.log('        ' + (c.title ? c.title + '：' : '') + (flat(c.brief, 60) || '（没有摘要）'))
    if (c.media.length) console.log('        照片 ' + c.media.length + ' 张：' + p(c.media[0]) + (c.media.length > 1 ? ' 等' : ''))
  }
  console.log('读全文  ：node scripts/appearance.mjs show <id>')
}

function findCard(id) {
  return cards.find((c) => String(c.id) === String(id)) || null
}

function show() {
  header()
  const id = rest[0]
  if (!id) {
    console.log('用法：node scripts/appearance.mjs show <id>（id 见 list 输出）')
    process.exitCode = 1
    return
  }
  const c = findCard(id)
  if (!c) {
    console.log('没有 id = ' + id + ' 的形象卡。现有：' + (cards.map((x) => x.id).join(', ') || '（一张都没有）'))
    process.exitCode = 1
    return
  }
  console.log('')
  console.log('[' + c.id + '] ' + (c.title || '（无标题）') + '   who=' + c.who + '  auto=' + (c.auto ? 'on' : 'off') + '  expand=' + c.expand)
  if (c.brief) console.log('摘要：' + c.brief)
  if (c.detail) console.log('正文：\n' + c.detail)
  else console.log('正文：（这张卡只有摘要，没有写 detail）')
  if (c.media.length) {
    console.log('照片（' + c.media.length + ' 张，路径可直接交给看图工具）：')
    for (const m of c.media) console.log('  ' + p(m) + (existsSync(m) ? '' : '   ← 文件不存在'))
  } else {
    console.log('照片：（无）')
  }
  console.log('')
  console.log('注入口径：' + (c.auto !== false
    ? (c.expand === 'full' ? '摘要 + 正文都常驻' : '只常驻摘要' + (cardHasHiddenBody(c) ? '，正文按需读（就是本命令）' : ''))
    : '不常驻（只进【形象目录】索引）'))
  console.log('本次会注入的正文：' + JSON.stringify(cardBody(c)))
}

function media() {
  const id = rest[0]
  if (!id) {
    console.log('用法：node scripts/appearance.mjs media <id>')
    process.exitCode = 1
    return
  }
  const c = findCard(id)
  if (!c) {
    console.log('没有 id = ' + id + ' 的形象卡。')
    process.exitCode = 1
    return
  }
  for (const m of c.media) console.log(p(m))
  if (!c.media.length) console.log('（这张卡没有登记照片路径）')
}

/**
 * 体检：在**原始 config** 上做（归一化会把空卡、重复 id 悄悄丢掉 —— 那正是要报出来的事）。
 * 有问题时退出码 1，方便脚本化。
 */
function check() {
  const raw = readRawConfig(cfgFile)
  if (raw === null) {
    console.log('config.json 不是合法 JSON —— 先修好它。')
    process.exitCode = 1
    return
  }
  const rawCards = (((raw || {}).persona || {}).appearance || {}).cards
  const list0 = Array.isArray(rawCards) ? rawCards : []
  const problems = []
  // notes = 不是错、只是现状说明（例如「正文按需读」正是设计意图）——
  // 它们不该让体检变红：红了的体检会被当成噪声，然后真问题也被忽略。
  const notes = []
  const seen = new Set()
  list0.forEach((c, i) => {
    const at = 'cards[' + i + ']'
    if (!c || typeof c !== 'object' || Array.isArray(c)) { problems.push(at + ' 不是对象 —— 会被丢掉'); return }
    const title = String(c.title == null ? '' : c.title).trim()
    const brief = String(c.brief == null ? '' : c.brief).trim()
    const detail = String(c.detail == null ? '' : c.detail).trim()
    if (!title && !brief && !detail) problems.push(at + ' title / brief / detail 全空 —— 会被丢掉')
    const id = String(c.id == null ? '' : c.id).trim()
    if (!id) problems.push(at + ' 没有 id —— 会按位置补成 card-' + (i + 1) + '，按 id 读全文时容易对不上')
    else if (seen.has(id)) problems.push(at + ' id "' + id + '" 重复 —— 只有第一张生效')
    else seen.add(id)
    if (c.who !== undefined && !CARD_WHO.includes(c.who)) problems.push(at + ' who="' + String(c.who) + '" 不认识（只认 ' + CARD_WHO.join(' / ') + '）—— 会当成 other')
    const auto = c.auto !== undefined ? !!c.auto : (c.who === 'self' || c.who === 'user')
    if (auto && !brief && !detail) problems.push(at + ' 常驻但没有 brief / detail —— 注入里只剩一个标题')
    if (auto && c.expand !== 'full' && detail) notes.push(at + ' 写了 detail 但 expand 不是 full —— 正文不常驻，要用时按 id 来读（这是设计，不是错）')
    const med = Array.isArray(c.media) ? c.media : []
    med.forEach((m, j) => {
      const s = String(m == null ? '' : m).trim()
      if (!s) problems.push(at + '.media[' + j + '] 是空串')
      else if (!existsSync(s)) problems.push(at + '.media[' + j + '] 路径不存在：' + p(s))
    })
  })
  if (rawCards !== undefined && !Array.isArray(rawCards)) problems.push('persona.appearance.cards 不是数组 —— 整段会被当成空卡表')
  if (ap.enabled !== true && (cards.length || list0.length)) {
    problems.push('appearance.enabled 不是 true —— 卡写了但一张都不会注入')
  }
  if (ap.index === false && cards.some((c) => cardHasHiddenBody(c))) {
    problems.push('appearance.index = false 且有卡带未展开的正文 —— AI 不知道这些卡存在，也就不会来读')
  }
  if (!problems.length) {
    console.log('体检通过：' + cards.length + ' 张卡，没有发现问题。')
    for (const s of notes) console.log('  · 说明：' + s)
    return
  }
  console.log('体检发现 ' + problems.length + ' 项：')
  for (const s of problems) console.log('  · ' + s)
  for (const s of notes) console.log('  · 说明（不是错）：' + s)
  console.log('（提示：config.json 里 persona.appearance.cards 由用户手改；schema 见 SPEC.md §2.3.1）')
  process.exitCode = 1
}

if (cmd === 'list') list()
else if (cmd === 'show') show()
else if (cmd === 'media') media()
else if (cmd === 'check') check()
else {
  console.error('未知命令：' + cmd + '（可用：list | show | media | check）')
  process.exitCode = 1
}
