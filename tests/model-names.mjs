// 自称解析测试（2026-09-18 新增：任何模型都能单独指定自称）
// 断言强制：任一 false 即非零退出
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const home = mkdtempSync(path.join(os.tmpdir(), 'whale-persona-selfname-'))
process.env.DSH_HOME = home
process.env.DSH_WHALE_CONFIG = path.join(home, 'whale-persona', 'config.json')

const t = (name, ok) => { console.log(name + ':', ok); if (!ok) process.exitCode = 1 }
const { selfNameOf } = await import('../core/render.js')
const { mergeConfig, DEFAULTS } = await import('../core/defaults.js')
const { buildPersonaPrompt } = await import('../core/prompt.js')

const base = { enabled: true, persona: { selfNameFlash: '我', selfNamePro: '我', userName: '小林', character: '你是{selfName}。' } }
const cfg = (patch) => mergeConfig(Object.assign({}, base, { persona: Object.assign({}, base.persona, patch) }))

// ① 两档回落（老行为不能坏）
t('N1 无表 → flash 档用 selfNameFlash', selfNameOf(cfg({ selfNameFlash: '姐姐', selfNamePro: '妈妈' }), 'flash', 'deepseek-v4-flash') === '姐姐')
t('N2 无表 → pro 档用 selfNamePro', selfNameOf(cfg({ selfNameFlash: '姐姐', selfNamePro: '妈妈' }), 'pro', 'deepseek-v4-pro') === '妈妈')

// ② 精确命中（忽略大小写）
t('N3 精确命中（原名）', selfNameOf(cfg({ selfNameByModel: { 'grok-4.7': '小七' } }), 'flash', 'grok-4.7') === '小七')
t('N4 精确命中（大小写不同）', selfNameOf(cfg({ selfNameByModel: { 'GLM-5.1': '小五' } }), 'pro', 'glm-5.1') === '小五')
t('N5 精确命中优先于子串', selfNameOf(cfg({ selfNameByModel: { 'glm': '大五', 'glm-5.1': '小五' } }), 'flash', 'GLM-5.1') === '小五')

// ③ 子串命中 + 最长优先（模型 id 带前缀/后缀时也能用）
t('N6 子串命中（带供应商前缀）', selfNameOf(cfg({ selfNameByModel: { 'glm-5.1': '小五' } }), 'flash', 'Pro/zai-org/GLM-5.1') === '小五')
t('N7 子串命中（带后缀）', selfNameOf(cfg({ selfNameByModel: { 'grok-4.7': '小七' } }), 'flash', 'x-ai/grok-4.7-flash') === '小七')
t('N8 最长子串优先', selfNameOf(cfg({ selfNameByModel: { 'grok': '大七', 'grok-4.7': '小七' } }), 'flash', 'x-ai/grok-4.7-flash') === '小七')

// ④ 没命中就回落到档位（不是"没人设"）
t('N9 未命中 → 回落档位', selfNameOf(cfg({ selfNameFlash: '姐姐', selfNameByModel: { 'grok-4.7': '小七' } }), 'flash', 'glm-5.2') === '姐姐')

// ⑤ 脏数据不炸
t('N10 空表', selfNameOf(cfg({ selfNameByModel: {} }), 'flash', 'x') === '我')
t('N11 值为空白的条目被忽略', selfNameOf(cfg({ selfNameFlash: '姐姐', selfNameByModel: { 'grok': '   ' } }), 'flash', 'grok-4.7') === '姐姐')
t('N12 表不是对象（坏配置）不炸', selfNameOf(cfg({ selfNameByModel: ['grok'] }), 'flash', 'grok-4.7') === '我')
t('N13 model 非字符串不炸', selfNameOf(cfg({ selfNameFlash: '姐姐' }), 'flash', undefined) === '姐姐')

// ⑥ mergeConfig 保留映射表、缺省补空表
t('N14 默认值含空表', !!DEFAULTS.persona.selfNameByModel && Object.keys(DEFAULTS.persona.selfNameByModel).length === 0)
t('N15 表被保留', mergeConfig({ persona: { selfNameByModel: { 'a': 'A' } } }).persona.selfNameByModel.a === 'A')

// ⑦ 端到端：三段正文里真的是按模型选的自称
const prompt = buildPersonaPrompt(cfg({ selfNameByModel: { 'grok-4.7': '小七' } }), 'x-ai/grok-4.7-flash', '', {})
t('N16 段落里用按模型的自称', prompt.indexOf('你是小七。') >= 0)
const prompt2 = buildPersonaPrompt(cfg({ selfNameFlash: '姐姐', selfNameByModel: { 'grok-4.7': '小七' } }), 'glm-5.2', '', {})
t('N17 其他模型仍走档位', prompt2.indexOf('你是姐姐。') >= 0 && prompt2.indexOf('小七') < 0)
