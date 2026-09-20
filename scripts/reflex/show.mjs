/**
 * show —— 一眼看清「我设了哪些条件反射、最近命中过没有」。
 * 跑法：node scripts/reflex.mjs show（只读，不改任何文件）
 */
import { readFileSync, existsSync } from 'node:fs'
import { loadRules, rulesPath } from '../../adapters/dsh/reflex/rules.js'
import { configDir } from '../../core/store.js'
import path from 'node:path'

const cfg = loadRules()
console.log('规则文件 :', rulesPath(), existsSync(rulesPath()) ? '(存在)' : '(不存在，装上还没配)')
console.log('状态     :', cfg.enabled ? '开' : '关', '| dryRun:', cfg.dryRun ? '是（只记账不动作）' : '否', '| 步级工具裁剪:', cfg.toolNarrowing ? '开' : '关（默认）')
console.log('规则条数 :', cfg.rules.length)
if (!cfg.rules.length) {
  console.log('  （空）把 examples/reflex.example.json 复制成上面那个路径，按自己情况改；dryRun 建议先留 true 跑一天。')
  console.log('  （想让它顺便"这一步只用某几个工具"：规则里写 then.tools，规则文件里开 "toolNarrowing": true —— 默认关。）')
} else {
  for (const r of cfg.rules) {
    const w = r.when || {}
    const act = r.then.reply ? '照抄回复：' + r.then.reply.slice(0, 24) : '注入约束'
    console.log('  - ' + r.id + '  档位=' + (w.tier || 'any') + (r.oncePerSession ? ' 每会话一次' : ''))
    console.log('      触发：' + (w.text || '(无文本条件)') + (w.model ? '  模型匹配：' + w.model : ''))
    console.log('      动作：' + act)
    if (r.then.tools && r.then.tools.length) console.log('      本步只留工具：' + r.then.tools.join(' / ') + (cfg.toolNarrowing ? '' : '  ← 规则文件里还没有 "toolNarrowing": true，现在不生效'))
  }
}

const logFile = path.join(configDir(), 'reflex.log.jsonl')
if (!existsSync(logFile)) {
  console.log('\n命中台账 : 还没有（说明一次都没触发过）')
} else {
  const rows = readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  const fire = rows.filter((r) => r.phase === 'fire')
  const dry = rows.filter((r) => r.phase === 'dry-run')
  console.log('\n命中台账 :', logFile)
  console.log('  fire ' + fire.length + ' 次 / dry-run ' + dry.length + ' 次 / 共记 ' + rows.length + ' 行')
  const by = {}
  for (const r of fire) by[r.rule] = (by[r.rule] || 0) + 1
  for (const [k, v] of Object.entries(by)) console.log('  规则 ' + k + ' 命中 ' + v + ' 次')
  const last = rows[rows.length - 1]
  if (last) console.log('  最近一行：' + last.t + ' ' + last.phase + ' ' + last.rule + (last.head ? ' 原话「' + last.head + '」' : ''))
  console.log('  （这些行就是「刚才为什么那样回答」的证据）')
}