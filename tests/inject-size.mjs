// 注入体积计量与预算单测（0.13.0）：口径恒等式 / 默认零行为改变 / 超预算提醒行 / 适配器同一通路
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = mkdtempSync(path.join(os.tmpdir(), 'whale-persona-size-'))
process.env.DSH_HOME = tmp
process.env.DSH_WHALE_CONFIG = path.join(tmp, 'whale-persona', 'config.json')
mkdirSync(path.join(tmp, 'whale-persona'), { recursive: true })
const write = (cfg) => writeFileSync(process.env.DSH_WHALE_CONFIG, JSON.stringify(cfg), 'utf8')

// 断言助手：false 必须让本测试脚本非零退出（与其余测试同一约定）
const t = (name, ok) => {
  console.log(name + ':', ok)
  if (!ok) process.exitCode = 1
}

const { apply } = await import('../adapters/dsh/index.js')
const { measureInjection, budgetOf, buildSuffixSection } = await import('../core/measure.js')
const { buildPersonaPrompt, buildThinkingLanguage } = await import('../core/prompt.js')
const { mergeConfig } = await import('../core/defaults.js')

const box = {}
apply({ systemPrompt: { section: (s) => { box[s.name] = s; return () => {} } } })

const agent = { options: { model: 'Pro/zai-org/GLM-5.1' }, session: { header: { id: 'size-test', cwd: 'D:/work/demo-project' } } }
const MODEL = 'Pro/zai-org/GLM-5.1'
const CWD = 'D:/work/demo-project'

const base = (extra) => Object.assign({
  enabled: true,
  persona: { enabled: true, userName: '小林', character: '你是{selfName}。', contracts: [{ id: 'a', text: '结论先行。', on: true }, { id: 'b', text: '不寒暄。', on: true }] },
  memory: { enabled: true, capture: 'always', entries: [{ text: '交付用简体中文', on: true }] },
}, extra || {})

// 适配器三段（真实注入口径）
const sectionTexts = () => ({
  prefix: box['deployment:persona-prefix'].text({ agent }),
  suffix: box['deployment:persona-suffix'].text({ agent }),
  thinking: box['whale:thinking-language'].text({ agent }),
})

// T1 默认（没配 budget）：关闭、无提醒行、三段恒等式成立
write(base())
const cfg1 = mergeConfig(base())
const m1 = measureInjection(cfg1, { model: MODEL, cwd: CWD, capture: true })
let s = sectionTexts()
t('T1a 默认关', m1.budget.enabled === false && m1.budget.max === 0)
t('T1b 默认无提醒行', m1.budget.note === '' && m1.budget.noteChars === 0)
t('T1c 恒等式(适配器三段 == 计量合计)', s.prefix.length + s.suffix.length + s.thinking.length === m1.total + m1.budget.noteChars)
t('T1d total == parts 求和', m1.total === m1.parts.reduce((a, x) => a + x.chars, 0))
t('T1e parts 齐全', m1.parts.map((x) => x.key).join(',') === 'persona,inbox,discipline,suffix,thinking')
const offCfg = base()
offCfg.persona.contracts.push({ id: 'z', text: '这条永不生效。', on: false })
write(offCfg)
const mOff = measureInjection(mergeConfig(offCfg), { model: MODEL, cwd: CWD, capture: true })
t('T1f 契约关掉的不计体积', mOff.parts[0].chars === m1.parts[0].chars)
write(base())
const _keep = [cfg1, m1]

// T2 显式 {enabled:false} 与完全不配 budget：注入文本逐字节相同（零行为改变）
write(base({ budget: { enabled: false, max: 5000 } }))
const s2 = sectionTexts()
t('T2 关着的预算不改一个字节', s2.prefix === s.prefix && s2.suffix === s.suffix && s2.thinking === s.thinking)

// T3 超预算：over 为真、提醒行非空，且提醒行确实出现在末尾段末尾、仍满足恒等式
write(base({ budget: { enabled: true, max: 10 } }))
const cfg3 = mergeConfig(base({ budget: { enabled: true, max: 10 } }))
const m3 = measureInjection(cfg3, { model: MODEL, cwd: CWD, capture: true })
const s3 = sectionTexts()
t('T3a over 判定', m3.budget.over === true && m3.total > 10)
t('T3b 提醒行非空且含实测数', m3.budget.note.includes('超预算') && m3.budget.note.includes(String(m3.total)))
t('T3c 提醒行落在末尾段末尾', s3.suffix.endsWith(m3.budget.note) && m3.budget.noteChars > 0)
t('T3d 恒等式（含提醒行）', s3.prefix.length + s3.suffix.length + s3.thinking.length === m3.total + m3.budget.noteChars)
t('T3e 计量不含提醒行自身（防自涨）', m3.budget.note.length === buildSuffixSection(cfg3, MODEL, CWD, true).length - (s3.suffix.length - m3.budget.note.length))

// T4 不超预算：over 为假、无提醒行
write(base({ budget: { enabled: true, max: 100000 } }))
const cfg4 = mergeConfig(base({ budget: { enabled: true, max: 100000 } }))
const m4 = measureInjection(cfg4, { model: MODEL, cwd: CWD, capture: true })
t('T4 未超限不打扰', m4.budget.over === false && m4.budget.note === '')

// T5 warnInPrompt:false = 只计量不打扰（over 仍为真）
write(base({ budget: { enabled: true, max: 10, warnInPrompt: false } }))
const cfg5 = mergeConfig(base({ budget: { enabled: true, max: 10, warnInPrompt: false } }))
const m5 = measureInjection(cfg5, { model: MODEL, cwd: CWD, capture: true })
t('T5 关掉提醒只留计量', m5.budget.over === true && m5.budget.note === '')

// T6 坏预算配置一律回落默认（不抛、不误开）
const b6 = budgetOf({ budget: { enabled: 'yes', max: -3, warnInPrompt: 'nope' } })
t('T6 坏配置回落', b6.enabled === false && b6.max === 0 && b6.warnInPrompt === true)
const m6 = measureInjection(mergeConfig(base({ budget: { enabled: 'yes', max: -3 } })), { model: MODEL, cwd: CWD, capture: true })
t('T6b 坏配置不注入提醒行', m6.budget.note === '')

// T7 人设越肥体积越大：契约多一条，人设段字符数增加（计量对得上真实渲染）
write(base({ budget: { enabled: true, max: 100000 } }))
const thin = measureInjection(mergeConfig(base({ budget: { enabled: true, max: 100000 } })), { model: MODEL, cwd: CWD, capture: true })
const fatCfg = base({ budget: { enabled: true, max: 100000 } })
fatCfg.persona.contracts.push({ id: 'c', text: '先给证据再给结论，不做无证据的断言。', on: true })
write(fatCfg)
const fat = measureInjection(mergeConfig(fatCfg), { model: MODEL, cwd: CWD, capture: true })
t('T7 契约增加 → 人设段变长', fat.parts[0].chars > thin.parts[0].chars && fat.total > thin.total)
