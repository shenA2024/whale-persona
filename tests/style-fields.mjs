// 形象 / 语气测试（0.9.0 新增：按模型设定形象与回复语气，两者都是 opt-in）
// 断言强制：任一 false 即非零退出
import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const home = mkdtempSync(path.join(os.tmpdir(), 'whale-persona-style-'))
process.env.DSH_HOME = home
process.env.DSH_WHALE_CONFIG = path.join(home, 'whale-persona', 'config.json')

const t = (name, ok) => { console.log(name + ':', ok); if (!ok) process.exitCode = 1 }
const { renderPersona, styleText, pickByModel } = await import('../core/render.js')
const { mergeConfig, DEFAULTS } = await import('../core/defaults.js')
const { buildPersonaPrompt } = await import('../core/prompt.js')
const { renderSections, configWarnings } = await import('../core/edit.js')
const { TONE_PRESETS } = await import('../core/presets.js')

const base = {
  enabled: true,
  persona: {
    selfNameFlash: '小助手', userName: '小林', character: '你是{selfName}。',
    contracts: [{ id: 'terse', text: '结论先行。', on: true }],
  },
}
const cfg = (patch) => mergeConfig(Object.assign({}, base, { persona: Object.assign({}, base.persona, patch) }))
const render = (patch, model) => renderPersona(cfg(patch), String(model || '').includes('pro') ? 'pro' : 'flash', model)

const APPEAR = { enabled: true, text: '你是一位 20 岁的女性，身高 1.75 m。', byModel: {} }
const TONE = { enabled: true, text: '语气温柔有耐心。', byModel: {} }

// ① 默认关（opt-in）：填了也不注入
t('A1 默认关：填了形象也不注入', render({ appearance: { enabled: false, text: '你是一位 20 岁的女性。' } }, 'deepseek-v4.1-flash').indexOf('形象设定') < 0)
t('A2 默认值就是关且空', DEFAULTS.persona.appearance.enabled === false && DEFAULTS.persona.appearance.text === '' && Object.keys(DEFAULTS.persona.appearance.byModel).length === 0)
t('A3 默认语气也是关且空', DEFAULTS.persona.tone.enabled === false && DEFAULTS.persona.tone.text === '')

// ② 开关打开 + 通用文本
const p1 = render({ appearance: APPEAR }, 'deepseek-v4.1-flash')
t('A4 开 + 通用文本 → 出现【形象设定】', p1.indexOf('【形象设定】') >= 0)
t('A5 形象原文逐字在内', p1.indexOf('- 你是一位 20 岁的女性，身高 1.75 m。') >= 0)
t('A6 指名持有人（用 userName）', p1.indexOf('以下是小林为你设定的形象') >= 0)

// ③ 按模型覆盖（用户的原始诉求：只给某个模型设形象）
const byModel = { enabled: true, text: '通用形象。', byModel: { 'deepseek-v4.1-flash': '你是一位 20 岁的女性，身高 1.75 m。' } }
const pHit = render({ appearance: byModel }, 'deepseek-v4.1-flash')
t('A7 按模型命中 → 用它，通用文本不出现', pHit.indexOf('身高 1.75 m') >= 0 && pHit.indexOf('通用形象') < 0)
const pMiss = render({ appearance: byModel }, 'glm-5.2')
t('A8 未命中 → 回落通用文本', pMiss.indexOf('通用形象。') >= 0 && pMiss.indexOf('1.75 m') < 0)
const pExact = render({ appearance: { enabled: true, text: '', byModel: { 'DeepSeek-V4.1-Flash': '精确命中的形象。' } } }, 'deepseek-v4.1-flash')
t('A9 大小写不同也算精确命中', pExact.indexOf('精确命中的形象。') >= 0)
const pSub = render({ appearance: { enabled: true, text: '', byModel: { 'v4.1-flash': '子串命中的形象。' } } }, 'Pro/deepseek/deepseek-v4.1-flash')
t('A10 带前缀的完整 id 走子串命中', pSub.indexOf('子串命中的形象。') >= 0)

// ④ 只配了按模型表、且没命中、又没通用文本 → 这一段整体不出现
t('A11 没命中且无兜底 → 不注入这一段', render({ appearance: { enabled: true, text: '', byModel: { 'grok-4.7': '别的模型的形象。' } } }, 'deepseek-v4.1-flash').indexOf('形象设定') < 0)

// ⑤ 占位符与位置：形象在「立场正文」之后、契约之前
const pOrder = render({ appearance: APPEAR, tone: TONE }, 'deepseek-v4.1-flash')
t('A12 形象在立场正文之后', pOrder.indexOf('你是小助手。') < pOrder.indexOf('【形象设定】'))
t('A13 形象在契约之前（硬约束排最后）', pOrder.indexOf('【形象设定】') < pOrder.indexOf('工作契约：'))
t('A14 占位符在形象里也被填充', render({ appearance: { enabled: true, text: '{userName}给你设定：你是{selfName}。' } }, 'x').indexOf('- 小林给你设定：你是小助手。') >= 0)

// ⑥ 语气
t('T1 语气默认关：不注入', render({ tone: { enabled: false, text: '语气温柔。' } }, 'x').indexOf('【回复语气】') < 0)
const pTone = render({ tone: TONE }, 'x')
t('T2 开 + 文本 → 出现【回复语气】', pTone.indexOf('【回复语气】') >= 0 && pTone.indexOf('- 语气温柔有耐心。') >= 0)
t('T3 语气块自述「不改结论与契约」', pTone.indexOf('不改变结论、证据标准与工作契约') >= 0)
t('T4 加了语气后契约仍在', pTone.indexOf('工作契约：') >= 0 && pTone.indexOf('- 结论先行。') >= 0)
const pToneHit = render({ tone: { enabled: true, text: '通用语气。', byModel: { 'glm': '严肃克制。' } } }, 'Pro/zai-org/GLM-5.1')
t('T5 语气按模型命中（子串）', pToneHit.indexOf('- 严肃克制。') >= 0 && pToneHit.indexOf('通用语气') < 0)

// ⑦ styleText / pickByModel 的脏数据容忍
t('S1 field 为 null / 数组不炸', styleText(null, 'x') === '' && styleText([1], 'x') === '')
t('S2 开关不是 true 就取空（只认严格 true）', styleText({ enabled: 'yes', text: 'A' }, 'x') === '')
t('S3 空值条目被忽略', pickByModel({ 'grok': '   ', 'glm': '小五' }, 'grok-4.7') === null)
t('S4 model 非字符串不炸', pickByModel({ 'a': 'A' }, undefined) === null)

// ⑧ mergeConfig：缺省补全 + 未知子键保留 + 坏形状回落
const m1 = mergeConfig({ persona: { appearance: { enabled: true, text: 'A' } } }).persona.appearance
t('M1 缺 byModel 时补空表', m1.enabled === true && m1.byModel && Object.keys(m1.byModel).length === 0)
const m2 = mergeConfig({ persona: { appearance: { enabled: true, text: 'A', byModel: { a: 'A' }, note: '未知子键' } } }).persona.appearance
t('M2 未知子键原样保留', m2.note === '未知子键' && m2.byModel.a === 'A')
const m3 = mergeConfig({ persona: { appearance: '不是对象', tone: ['x'] } }).persona
t('M3 坏形状回落默认不炸', m3.appearance.enabled === false && m3.tone.text === '')

// ⑨ 零行为改变：纯默认下 prefix 为空
t('Z1 纯默认渲染为空（装上零行为改变）', renderPersona(mergeConfig(null), 'flash', 'deepseek-v4.1-flash') === '')

// ⑩ 告警（静默失效点名）
const w1 = configWarnings(mergeConfig({ persona: { appearance: { enabled: false, text: '填了但没开。' } } }), 'flash')
t('W1 填了没开 → 有告警', w1.some((x) => x.indexOf('「形象」') >= 0))
const w2 = configWarnings(mergeConfig({ persona: { tone: { enabled: true, text: '', byModel: { 'grok-4.7': '别的模型的语气。' } } } }), 'deepseek-v4.1-flash')
t('W2 开着但当前模型没命中且无兜底 → 有告警', w2.some((x) => x.indexOf('「语气」') >= 0))
const w3 = configWarnings(cfg({ appearance: APPEAR, tone: TONE }), 'deepseek-v4.1-flash')
t('W3 正常命中 → 无这两类告警', !w3.some((x) => x.indexOf('「形象」') >= 0 || x.indexOf('「语气」') >= 0))
const w4 = configWarnings(mergeConfig({ persona: { tone: { enabled: true, text: '只有通用语气。' } } }), 'deepseek-v4.1-flash')
t('W4 通用文本兜底时不算没命中', !w4.some((x) => x.indexOf('「语气」') >= 0))

// ⑪ 面板/本地页的预览口径（core/edit.js 的 renderSections）
const sec = renderSections({ enabled: true, persona: { userName: '小林', appearance: APPEAR, tone: TONE } }, { model: 'deepseek-v4.1-flash' })
t('E1 预览里带形象与语气', sec.prefix.indexOf('【形象设定】') >= 0 && sec.prefix.indexOf('【回复语气】') >= 0)
const sec2 = renderSections({ enabled: true, persona: { userName: '小林', appearance: { enabled: true, text: 'A' } } }, { model: 'flash' })
t('E2 预览里未开启的语气不出现', sec2.prefix.indexOf('【形象设定】') >= 0 && sec2.prefix.indexOf('【回复语气】') < 0)

// ⑫ 语气预设（供两个界面一键填入）
t('P1 预设 4 条、字段齐全', Array.isArray(TONE_PRESETS) && TONE_PRESETS.length === 4
  && TONE_PRESETS.every((x) => x && x.id && x.label && String(x.text).length > 20))
t('P2 预设 id 不重复', new Set(TONE_PRESETS.map((x) => x.id)).size === TONE_PRESETS.length)

// ⑬ 宿主真实模型 id 的记录（界面显示名 ≠ id，2026-09-19 实测踩坑后加）
const { recordModel, readLastModel } = await import('../core/lastModel.js')
recordModel('deepseek-flash')
t('L1 记录后读得回来', readLastModel() === 'deepseek-flash')
const lm = path.join(home, 'whale-persona', 'last-model.json')
const before = JSON.parse(readFileSync(lm, 'utf8'))
const stamp = readFileSync(lm, 'utf8')
recordModel('deepseek-flash')
t('L2 同一个 id 不重写盘（会话每步都求值，不能每步写盘）', readFileSync(lm, 'utf8') === stamp)
t('L2b 落的是 id 不是显示名', before.model === 'deepseek-flash' && typeof before.at === 'string')
recordModel('')
recordModel(undefined)
recordModel(123)
t('L3 空值/非字符串不覆盖已有记录', readLastModel() === 'deepseek-flash')
recordModel('Pro/deepseek/deepseek-v4.1-flash')
t('L4 换模型会更新', readLastModel() === 'Pro/deepseek/deepseek-v4.1-flash')
t('L5 记录的 id 能被 byModel 子串命中', render({ appearance: { enabled: true, text: '', byModel: { 'deepseek-v4.1-flash': '命中。' } } }, readLastModel()).indexOf('命中。') >= 0)

// ⑭ 端到端：buildPersonaPrompt 真的按模型选形象
const e2e = buildPersonaPrompt(cfg({ appearance: byModel }), 'deepseek-v4.1-flash', '', {})
t('X1 端到端按模型注入形象', e2e.indexOf('身高 1.75 m') >= 0)
const e2e2 = buildPersonaPrompt(cfg({ appearance: byModel }), 'deepseek-v4-pro', '', {})
t('X2 别的模型不串味', e2e2.indexOf('1.75 m') < 0 && e2e2.indexOf('通用形象。') >= 0)
