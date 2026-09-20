/**
 * 造规则的闸门回归（2026-09-20 加，触发来源：访谈式创建立项）。
 * 判据：①不写 --yes = 只试不写（文件零变化）；②正反例都干净才写盘；
 *   ③反例被硬命中 → 非零退出且**文件零变化**（宁可不加，也不留会误伤的规则）。
 * 跑法：node tests/newrule.mjs（退出码非 0 = 有失败）
 */
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.dirname(HERE)
const tmp = mkdtempSync(path.join(os.tmpdir(), 'whale-reflex-new-'))
const rulesFile = path.join(tmp, 'reflex.json')
process.env.DSH_REFLEX_RULES = rulesFile

let failed = 0
let checks = 0
function check(label, ...rest) {
  checks++
  const bad = rest.some((v) => v === false)
  if (bad) failed++
  console.log((bad ? 'FAIL ' : '') + label, ...rest)
}

const base = { _note: '测试用', enabled: true, dryRun: false, rules: [
  { id: 'old-rule', priority: 100, when: { tier: 'flash', text: '^报数$' }, then: { reply: '一' } },
] }
const writeBase = () => writeFileSync(rulesFile, JSON.stringify(base, null, 2) + '\n', 'utf8')

function runNew(args) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'reflex.mjs'), 'new'].concat(args), {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { DSH_REFLEX_RULES: rulesFile }),
    cwd: ROOT,
  })
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') }
}

const goodArgs = [
  '--id', 'born-good', '--tier', 'flash',
  '--nearAny', '咱俩什么关系|我们什么关系', '--reply', '照抄这一句',
  '--pos', '咱俩什么关系|我们什么关系', '--neg', '这段代码是谁写的',
]

// T1 不给 --yes：只试不写
writeBase()
let r = runNew(goodArgs)
check('T1 试算退出码 0', r.code === 0)
check('T1 试算命中正例', r.out.includes('born-good'))
check('T1 未写盘', JSON.parse(readFileSync(rulesFile, 'utf8')).rules.length === 1)
check('T1 打印加 --yes 的提示', r.out.includes('--yes'))

// T2 给 --yes：写盘 + 体检通过
r = runNew(goodArgs.concat(['--yes']))
check('T2 写盘退出码 0', r.code === 0)
const after = JSON.parse(readFileSync(rulesFile, 'utf8'))
check('T2 规则真的落盘', after.rules.length === 2 && after.rules[1].id === 'born-good')
check('T2 保留 _note', after._note === '测试用')
check('T2 留了备份', readdirSync(tmp).some((f) => f.startsWith('reflex.json.bak-')))

// T3 反例被硬命中 → 非零退出且文件零变化
writeBase()
const before = readFileSync(rulesFile, 'utf8')
r = runNew([
  '--id', 'born-bad', '--tier', 'any', '--text', '关系',
  '--reply', 'x', '--pos', '这关系不大', '--neg', '这段代码是谁写的|咱俩什么关系', '--yes',
])
check('T3 反例冲突时非零退出', r.code === 1)
check('T3 打了 ERROR', r.out.includes('ERROR'))
check('T3 文件零变化', readFileSync(rulesFile, 'utf8') === before)

// T4 缺正例 → 非零退出（访谈第 1 问没答完不算建好）
r = runNew(['--id', 'born-nopos', '--tier', 'flash', '--nearAny', '咱俩什么关系', '--reply', 'x', '--yes'])
check('T4 缺正例时非零退出', r.code === 1)
check('T4 报的是缺正例', r.out.includes('--pos'))
check('T4 文件零变化', readFileSync(rulesFile, 'utf8') === before)

// T5 重复 id → 非零退出
r = runNew(['--id', 'old-rule', '--tier', 'flash', '--nearAny', '报数', '--reply', 'x', '--pos', '报数', '--yes'])
check('T5 重复 id 被拦下', r.code === 1 && r.out.includes('已存在'))

console.log('-- newrule 闸门：' + (failed ? failed + '/' + checks + ' 项失败' : checks + ' 项全过'))
process.exit(failed ? 1 : 0)
