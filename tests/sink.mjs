// 沉降路由单测（0.13.0）：kind 隔离 / 确认即落盘 / 幂等 / 模板与格式 / 坏路由降级 / 纪律块只在配了路由时出现
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = mkdtempSync(path.join(os.tmpdir(), 'whale-persona-sink-'))
process.env.DSH_HOME = tmp
process.env.DSH_WHALE_CONFIG = path.join(tmp, 'whale-persona', 'config.json')
mkdirSync(path.join(tmp, 'whale-persona'), { recursive: true })
const CFG = process.env.DSH_WHALE_CONFIG
const HOME = process.env.DSH_HOME
const INBOX = path.join(tmp, 'whale-persona', 'memory-inbox.jsonl')
const PIT = path.join(tmp, 'out', 'pitfalls.md')
const IDEAS = path.join(tmp, 'out', 'ideas.jsonl')
const NOTES = path.join(tmp, 'out', 'notes.txt')

const t = (name, ok) => {
  console.log(name + ':', ok)
  if (!ok) process.exitCode = 1
}
const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '')
const lines = (f) => read(f).split(/\r?\n/).filter(Boolean)

const cfgWith = (sinks) => ({
  enabled: true,
  persona: { enabled: true, selfNameFlash: '小助手', userName: '小林', character: '你是{selfName}。', contracts: [{ text: '结论先行。', on: true }] },
  memory: {
    enabled: true, capture: 'always', inbox: true,
    entries: [{ text: '手工条目：交付用简体', on: true }],
    sinks,
  },
})

const SINK_ROUTES = {
  pitfall: { path: PIT, header: '## 坑库（whale-persona 沉降）\n' },
  idea: { path: IDEAS, format: 'jsonl' },
  note: { path: NOTES, format: 'plain', template: 'NOTE {text} @ {date} ({kind})' },
}
writeFileSync(CFG, JSON.stringify(cfgWith(SINK_ROUTES)), 'utf8')

const seedInbox = () => {
  writeFileSync(INBOX, [
    JSON.stringify({ text: '记忆候选A', at: '2026-09-20T01:00:00Z', status: 'proposed' }),
    JSON.stringify({ text: '坑：CI 路径门禁按磁盘判会本机绿 CI 红', kind: 'pitfall', at: '2026-09-20T02:00:00Z', status: 'proposed' }),
    JSON.stringify({ text: '想法：注入体积该被计量', kind: 'idea', at: '2026-09-20T03:00:00Z', status: 'proposed' }),
    JSON.stringify({ text: '已确认但无路由的孤儿条目', kind: 'orphan', at: '2026-09-20T04:00:00Z', status: 'proposed' }),
    JSON.stringify({ text: '花样 kind 应被归一化', kind: '../etc/passwd', at: '2026-09-20T05:00:00Z', status: 'proposed' }),
    JSON.stringify({ text: '老格式无 kind 条目', at: '2026-09-20T06:00:00Z' }),
  ].join('\n') + '\n', 'utf8')
}
seedInbox()

const { apply } = await import('../adapters/dsh/index.js')
const { buildPersonaPrompt } = await import('../core/prompt.js')
const { mergeConfig } = await import('../core/defaults.js')
const { kindOf, readInjected, replayInbox } = await import('../core/memoryInbox.js')
const { sinkConfirmed, sinkRoutes, renderSinkText, readSinkLog } = await import('../core/sinks.js')

const box = {}
apply({ systemPrompt: { section: (s) => { box[s.name] = s; return () => {} } } })
const agent = { options: { model: 'flash-x' }, session: { header: { id: 'sink-test', cwd: tmp } } }
const prompt = () => box['deployment:persona-prefix'].text({ agent })

const cfg = mergeConfig(cfgWith(SINK_ROUTES))
const mem = cfg.memory

// T1 kind 归一化与路由归一化
t('T1a kind 归一化（危险字符被剥掉）', kindOf({ kind: '../etc/passwd' }) === 'etcpasswd')
t('T1b 缺省 kind = memory', kindOf({}) === 'memory' && kindOf({ kind: '' }) === 'memory')
const routes = sinkRoutes(mem)
t('T1c 只收有 path 的路由', Object.keys(routes).sort().join(',') === 'idea,note,pitfall')
t('T1d kind:memory 不进沉降', Object.keys(sinkRoutes({ sinks: { memory: { path: 'x.md' } } })).length === 0)
t('T1e 坏形状丢弃', Object.keys(sinkRoutes({ sinks: { a: 'str', b: {}, c: null } })).length === 0)

// T2 注入只认 memory 类 + 已确认：分类条目与 proposed 一律不进提示词
let out = prompt()
t('T2a 已确认的手工条目在', out.includes('手工条目：交付用简体'))
t('T2b 分类候选不进提示词', !out.includes('CI 路径门禁') && !out.includes('注入体积该被计量'))
t('T2c memory 类 proposed 也不进', !out.includes('记忆候选A'))

// T3 纪律块只在配了路由时出现（默认零行为改变）
t('T3a 配了路由 → 注入分类路由说明', out.includes('分类路由') && out.includes('pitfall') && out.includes(PIT.replace(/\\/g, '/')))
writeFileSync(CFG, JSON.stringify(cfgWith({})), 'utf8')
const noSink = mergeConfig(cfgWith({}))
t('T3b 没配路由 → 一个字都不提', !buildPersonaPrompt(noSink, 'flash-x', tmp, { capture: true }).includes('分类路由'))
writeFileSync(CFG, JSON.stringify(cfgWith(SINK_ROUTES)), 'utf8')

// T4 渲染口径：模板与格式
t('T4a md 默认模板', renderSinkText(routes.pitfall, { text: '坑A', at: '2026-09-20T00:00:00Z' }, {}) === '- 坑A（2026-09-20）')
t('T4b plain 自定义模板', renderSinkText(routes.note, { text: '记一笔', at: '2026-09-20T00:00:00Z' }, {}).startsWith('NOTE 记一笔 @ 2026-09-20'))
const j = JSON.parse(renderSinkText(routes.idea, { text: '想法A', at: '2026-09-20T00:00:00Z', kind: 'idea' }, {}))
t('T4c jsonl 结构', j.text === '想法A' && j.kind === 'idea' && j.source === 'memory.mjs')
t('T4d 换行被折叠（防注入）', !renderSinkText(routes.pitfall, { text: 'a\nb' }, {}).includes('\n'))

// T5 人工确认 → 落盘（走真实 CLI）
const raw = () => readFileSync(INBOX, 'utf8').split(/\r?\n/)
const run = (args) => spawnSync(process.execPath, [path.join(process.cwd(), 'scripts', 'memory.mjs')].concat(args), {
  encoding: 'utf8', env: Object.assign({}, process.env, { DSH_HOME: HOME, DSH_WHALE_CONFIG: CFG }),
})
const iPit = replayInbox(raw()).findIndex((e) => e.text.startsWith('坑：'))
const r1 = run(['confirm', String(iPit)])
t('T5a CLI 确认成功', r1.status === 0 && r1.stdout.includes('已确认 1 条'))
t('T5b 目标文件按路由生成（含 header）', read(PIT).startsWith('## 坑库') && read(PIT).includes('- 坑：CI 路径门禁按磁盘判会本机绿 CI 红（2026-09-20）'))
t('T5c 沉降报告可见', r1.stdout.includes('已沉降 kind:"pitfall"'))
t('T5d 收件箱追加 confirm + drop 行', lines(INBOX).some((l) => l.includes('"op":"confirm"')) && lines(INBOX).some((l) => l.includes('"op":"drop"')))
t('T5e 沉降日志可审计', readSinkLog(mem).some((r) => r.kind === 'pitfall' && r.bytes > 0))

// T6 已沉降的条目出队 → 不注入、也不再出现
out = prompt()
t('T6a 沉降后不进提示词', !out.includes('CI 路径门禁'))
t('T6b 收件箱视图里已出队', !replayInbox(raw()).some((e) => e.text.startsWith('坑：')))

// T7 jsonl 路由走 CLI（序号要在当前视图上重算 —— 上一条已沉降出队，序号会漂）
const r2 = run(['confirm', String(replayInbox(raw()).findIndex((e) => e.text.startsWith('想法：')))])
const ideaRows = lines(IDEAS).map((l) => JSON.parse(l))
t('T7 jsonl 落一行', r2.status === 0 && ideaRows.length === 1 && ideaRows[0].kind === 'idea')

// T8 幂等：同样的候选（同 kind + 同正文 + 同目标）再来一次，认日志里的已落盘，不重复写
const before = read(PIT)
seedInbox()
const again = sinkConfirmed(mem, raw(), [replayInbox(raw()).findIndex((e) => e.text.startsWith('坑：'))], { source: 'test' })
t('T8a 重复沉降被识别为已落盘', again.sunk.length === 0 && again.skipped.length === 1 && again.skipped[0].reason === 'already-sunk')
t('T8b 文件没被重复写', read(PIT) === before && !again.dropLines.length)

// T9 无路由的 kind：显式报出来、不写任何文件、也不出队
const r3 = run(['confirm', 'all'])
seedInbox()
const { sinkConfirmed: sc } = await import('../core/sinks.js')
const noRoute = sc(mem, raw(), [3], { source: 'test' })
t('T9a 无路由被报告', noRoute.noRoute.length === 1 && noRoute.noRoute[0].kind === 'orphan')
t('T9b 无路由不出队', noRoute.dropLines.length === 0)

// T10 写不进去也不炸：目标目录是个文件 → 报错而非抛异常
const badTarget = path.join(tmp, 'as-a-file')
writeFileSync(badTarget, 'x', 'utf8')
const badCfg = cfgWith({ pitfall: { path: path.join(badTarget, 'sub', 'x.md') } })
const badRes = sc(mergeConfig(badCfg).memory, raw(), [1], { source: 'test' })
t('T10 写失败降级为报告', badRes.errors.length === 1 && !!badRes.errors[0].error)

// T11 readInjected 仍然只给 memory 类（旧行为逐字节不变）
const inj = readInjected(INBOX, { allowLegacy: false })
t('T11 注入视图只有 memory 类', inj.every((e) => kindOf(e) === 'memory') && inj.length === 0)
