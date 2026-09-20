#!/usr/bin/env node
/**
 * new —— 「加一条条件反射」的唯一入口（AI 访谈流程的第 3、4 步）。
 *
 * 为什么要它（2026-09-20 立项，触发来源：用户提「创建条件反射应该由 AI 问用户要什么内容」）：
 *   以前的路子是「用户把一句话丢给 AI，AI 自己拍规则」——没有正反例试命中，没有闸门，
 *   规则写歪了要等真实会话误伤才发现（当天就踩过：词袋里放称呼词 → 「又失败了，<persona-name>」被误命中）。
 *   本脚本把这条路径变成可验收的四步：**草稿 → 正反例试命中 → 写盘（先备份）→ 体检闸门**。
 *   体检不过就**回滚**，绝不把没验过的规则留在盘上。
 *
 * 跑法（访谈完由 AI 调）：
 *   node scripts/reflex.mjs new \
 *     --pos '你知道自己的身份吗|咱俩什么关系'  --neg '这段代码是谁写的|做一下身份认证' \
 *     --id identity-x --tier flash --nearAny '咱俩什么关系' --text '知道自己.{0,4}身份' \
 *     --reply '照抄要回答的那一句' [--directive '用一句话说完'] [--yes]
 *
 * 退出码：0 = 无错误（没给 --yes 时=只试不写；给了 --yes 时=已写入且体检通过）
 *         1 = 有错误（未写入 / 已回滚）
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { rulesPath } from '../../adapters/dsh/reflex/rules.js'
import { matchRule, normalize, tierOf } from '../../adapters/dsh/reflex/match.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const argOf = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null }
const has = (n) => argv.includes(n)
const listOf = (n) => { const v = argOf(n); return v ? String(v).split('|').map((s) => s.trim()).filter(Boolean) : [] }

const errors = []
const warns = []
const notes = []

const file = rulesPath()
if (!existsSync(file)) errors.push('规则文件不存在：' + file + '（先让会话跑一次，插件会自动落一份空的）')

let cfg = null
if (!errors.length) {
  try { cfg = JSON.parse(readFileSync(file, 'utf8')) }
  catch (e) { errors.push('规则文件不是合法 JSON：' + e.message) }
}
if (!errors.length && !Array.isArray(cfg.rules)) errors.push('规则文件里 rules 不是数组')

const id = (argOf('--id') || '').trim()
const tier = (argOf('--tier') || 'any').trim()
const text = argOf('--text') || ''
const textNot = argOf('--textNot') || ''
const nearAny = listOf('--nearAny')
const keywords = listOf('--keywords')
const minHits = argOf('--minHits') ? Number(argOf('--minHits')) : 0
const reply = argOf('--reply') || ''
const directive = argOf('--directive') || ''
const extra = argOf('--extra') || ''
const maxChars = argOf('--maxChars') ? Number(argOf('--maxChars')) : 0
const pos = listOf('--pos')
const neg = listOf('--neg')

if (!id) errors.push('缺 --id（规则的稳定标识，比如 identity-flash）')
if (['flash', 'pro', 'any'].indexOf(tier) < 0) errors.push('--tier 只能是 flash / pro / any，现在是 ' + tier)
if (!reply && !directive) errors.push('缺动作：--reply（照抄一句）或 --directive（注入约束）至少一个')
if (!text && !nearAny.length && !keywords.length) errors.push('缺触发条件：--text / --nearAny / --keywords 至少一个')
if (!pos.length) errors.push('缺 --pos（至少一条"这句话必须命中"的正例，访谈第 1 问）')
if (!neg.length) warns.push('没给 --neg（"这句话绝不该命中"的反例）—— 没有反例就没法证明不会误伤，建议补')
if (keywords.length && !(minHits > 0)) warns.push('给了 --keywords 但没给 --minHits，按默认 2 处理（词袋至少要两个词同时出现）')
for (const [label, re] of [['--text', text], ['--textNot', textNot]]) {
  if (!re) continue
  try { new RegExp(re, 'i') } catch (e) { errors.push(label + ' 正则编译失败：' + e.message) }
}

const rule = {
  id,
  priority: argOf('--priority') ? Number(argOf('--priority')) : 100,
  oncePerSession: has('--once'),
  when: Object.assign({ tier },
    text ? { text } : {},
    textNot ? { textNot } : {},
    nearAny.length ? { nearAny } : {},
    keywords.length ? { keywords, minHits: minHits > 0 ? minHits : 2 } : {},
    maxChars > 0 ? { maxChars } : {}),
  then: Object.assign({}, reply ? { reply } : {}, directive ? { directive } : {}, extra ? { extra } : {}),
}

const existing = Array.isArray(cfg && cfg.rules) ? cfg.rules : []
if (existing.some((r) => r && r.id === id)) errors.push('规则 id 已存在：' + id + '（改名，或先删掉旧的再建）')

const pick = (rules, t, tierName) => matchRule(rules, { text: t, tier: tierName, model: '', normalized: normalize(t), fired: new Set() })
const tierList = tier === 'any' ? ['flash', 'pro', 'other'] : [tier]
const probe = (rules, t) => {
  for (const tn of tierList) { const h = pick(rules, t, tn); if (h) return { tier: tn, hit: h } }
  return null
}

console.log('== 草稿 ==')
console.log(JSON.stringify(rule, null, 2))
console.log('规则文件：' + file + '（现有 ' + existing.length + ' 条）')

console.log('== 正例（必须命中新规则）==')
const withNew = existing.concat([rule])
for (const t of pos) {
  const r = probe(withNew, t)
  if (!r) { errors.push('正例没命中：' + JSON.stringify(t) + '（触发条件写窄了，或档位不对）'); console.log('  ✗ ' + JSON.stringify(t) + ' → 未命中'); continue }
  if (r.hit.rule.id !== id) { errors.push('正例命中的是别的规则：' + JSON.stringify(t) + ' → ' + r.hit.rule.id + '（优先级/条件重叠，先理清）'); console.log('  ✗ ' + JSON.stringify(t) + ' → ' + r.hit.rule.id); continue }
  if (r.hit.soft) warns.push('正例只拿到软命中（词袋）：' + JSON.stringify(t) + ' —— 软命中自带"不符就忽略"，稳定做法是补 --nearAny 或 --text')
  console.log('  ✓ ' + JSON.stringify(t) + ' → ' + id + '［' + r.tier + ' 档 / ' + r.hit.why + (r.hit.soft ? ' / 软命中' : '') + '］')
}

console.log('== 反例（必须不命中）==')
for (const t of neg) {
  const r = probe(withNew, t)
  if (!r) { console.log('  ✓ ' + JSON.stringify(t) + ' → 未命中'); continue }
  if (r.hit.rule.id === id && !r.hit.soft) { errors.push('反例被硬命中：' + JSON.stringify(t) + '（这条规则会误伤，改条件或加 --textNot）'); console.log('  ✗ ' + JSON.stringify(t) + ' → ' + id + '（' + r.hit.why + '）') }
  else if (r.hit.rule.id === id) { warns.push('反例被软命中：' + JSON.stringify(t) + '（软命中会自带忽略条款，但最好收紧词袋）'); console.log('  ! ' + JSON.stringify(t) + ' → ' + id + '（软命中 ' + r.hit.why + '）') }
  else { warns.push('反例命中了别的规则：' + JSON.stringify(t) + ' → ' + r.hit.rule.id); console.log('  ! ' + JSON.stringify(t) + ' → 别的规则 ' + r.hit.rule.id) }
}
if (tierList.length === 3 && pos.length) notes.push('档位=any 时按 flash/pro/other 各判一次；真实会话只看你当时的模型档位')

console.log('== 结论 ==')
if (errors.length) {
  for (const e of errors) console.log('ERROR ' + e)
  for (const w of warns) console.log('WARN  ' + w)
  console.log('没有写入任何东西（先把上面的 ERROR 修掉）')
  process.exit(1)
}
for (const w of warns) console.log('WARN  ' + w)
for (const n of notes) console.log('注：' + n)

if (!has('--yes')) {
  console.log('试算无 ERROR。确认无误后重跑同一条命令并加 --yes 才会写盘：')
  console.log('  ' + [process.argv[0], process.argv[1]].concat(argv).join(' ') + ' --yes')
  process.exit(0)
}

const bak = file + '.bak-' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
copyFileSync(file, bak)
const next = Object.assign({}, cfg, { rules: existing.concat([rule]) })
writeFileSync(file, JSON.stringify(next, null, 2) + '\n', 'utf8')

// 闸门：写盘后立刻按同一份体检脚本复核；不过就回滚（绝不留没验过的规则）
const chk = spawnSync(process.execPath, [path.join(HERE, 'check.mjs')], { encoding: 'utf8', shell: false })
const out = String(chk.stdout || '') + String(chk.stderr || '')
console.log('== 体检（node scripts/reflex.mjs check）==')
console.log(out.trim())
if (chk.status !== 0) {
  copyFileSync(bak, file)
  console.log('体检没过（退出码 ' + chk.status + '）→ 已回滚到 ' + bak + '，盘上没有这条规则')
  process.exit(1)
}
console.log('已写入 ' + file + '（备份 ' + bak + '）')
console.log('下一步：设置页 →「条件反射」点刷新即见；真用一次后回头看命中台账')
