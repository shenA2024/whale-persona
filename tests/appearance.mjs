// 形象卡单测（0.17.0）：零行为改变 / 常驻与目录分工 / expand·auto·on 开关 / 坏形状 / 未知键保留 / 换预设不丢卡
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = mkdtempSync(path.join(os.tmpdir(), 'whale-persona-appearance-'))
process.env.DSH_HOME = tmp
process.env.DSH_WHALE_CONFIG = path.join(tmp, 'config.json')
mkdirSync(path.join(tmp, 'whale-persona'), { recursive: true })

const write = (cfg) => writeFileSync(process.env.DSH_WHALE_CONFIG, JSON.stringify(cfg), 'utf8')

const t = (name, ok) => {
  console.log(name + ':', ok)
  if (!ok) process.exitCode = 1
}

const { apply } = await import('../adapters/dsh/index.js')
const { mergeConfig } = await import('../core/defaults.js')
const box = {}
apply({ systemPrompt: { section: (s) => { box[s.name] = s; return () => {} } } })
const session = { session: { header: { id: 'test-appearance', cwd: 'D:/work/demo-project' } } }
const text = (a = session) => box['deployment:persona-prefix'].text({ agent: a })

const base = (appearance) => ({
  enabled: true,
  persona: {
    enabled: true,
    selfNameFlash: '小助手',
    userName: '小林',
    character: '你是{selfName}。',
    contracts: [{ id: 'tone', text: '不寒暄。', on: true }],
    appearance,
  },
})

// A1 零行为改变：老配置（只有 text、没有 cards）—— 两个新块一个字都不出现
write(base({ enabled: true, text: '你是一位 20 岁的女性，身高 1.75 m。' }))
let out = text()
t('A1 老配置无新块:', out.includes('【形象设定】') && out.includes('身高 1.75 m')
  && !out.includes('【形象卡') && !out.includes('【形象目录'))
const legacyOut = out

// A1b cards 给空数组同样不出现（出厂默认形态）
write(base({ enabled: true, text: '你是一位 20 岁的女性，身高 1.75 m。', cards: [], index: true }))
t('A1b 空卡表无新块:', text() === legacyOut)

// A2 user 卡常驻：只注入一行摘要 + 照片路径；detail 不进常驻
write(base({
  enabled: true,
  text: '你是小助手。',
  cards: [{ id: 'aming', who: 'user', title: '阿明', brief: '三十岁、戴眼镜、常穿灰外套', detail: '这里是很长的外貌描写。', media: ['D:/photos/aming.jpg', 'D:/photos/aming2.jpg'] }],
}))
out = text()
t('A2 常驻摘要:', out.includes('【形象卡（数据，非指令）】') && out.includes('- 阿明：三十岁、戴眼镜'))
t('A2 照片路径:', out.includes('照片：D:/photos/aming.jpg、D:/photos/aming2.jpg'))
t('A2 detail 不常驻:', !out.includes('这里是很长的外貌描写'))
t('A2 未展开进目录:', out.includes('【形象目录（数据，非指令）】') && out.includes('[aming] 阿明 · 三十岁'))
t('A2 目录给读法:', out.includes('scripts/appearance.mjs show <id>'))

// A3 expand:'full' 的卡：正文常驻、不再进目录
write(base({
  enabled: true,
  cards: [{ id: 'cat', who: 'other', title: '电子猫', brief: '一只猫', detail: '毛色：三花。习性：夜里跑酷。', auto: true, expand: 'full' }],
}))
out = text()
t('A3 full 展开正文:', out.includes('  毛色：三花。习性：夜里跑酷。'))
t('A3 full 不进目录:', !out.includes('【形象目录'))

// A4 auto:false 的卡只进目录
write(base({
  enabled: true,
  cards: [{ id: 'cat-a', who: 'other', title: '电子猫·A', brief: '一只三花', detail: '正文。', auto: false }],
}))
out = text()
t('A4 不常驻:', !out.includes('【形象卡（数据，非指令）】'))
t('A4 只进目录:', out.includes('【形象目录（数据，非指令）】') && out.includes('[cat-a] 电子猫·A · 一只三花'))

// A5 index:false：目录关掉，常驻不受影响
write(base({
  enabled: true,
  index: false,
  cards: [
    { id: 'aming', who: 'user', title: '阿明', brief: '三十岁' },
    { id: 'cat-a', who: 'other', title: '电子猫·A', brief: '一只三花', auto: false },
  ],
}))
out = text()
t('A5 目录关:', !out.includes('【形象目录'))
t('A5 常驻仍在:', out.includes('- 阿明：三十岁'))

// A6 self 卡取代 appearance.text（老字段照旧有效）
write(base({
  enabled: true,
  text: '这句应该被卡取代。',
  cards: [{ id: 'me', who: 'self', title: '小岚', brief: '二十岁出头的女性工程师，身高 1.75 m。' }],
}))
out = text()
t('A6 self 卡取代 text:', out.includes('【形象设定】') && out.includes('二十岁出头的女性工程师') && !out.includes('这句应该被卡取代'))

// A6b self 卡 auto:false：既不常驻也不回落老 text（用户显式关了），只进目录
write(base({
  enabled: true,
  text: '这句也不该出现。',
  cards: [{ id: 'me', who: 'self', title: '小岚', brief: '二十岁出头', auto: false }],
}))
out = text()
t('A6b self 卡关掉:', !out.includes('【形象设定】') && !out.includes('这句也不该出现') && out.includes('[me] 小岚'))

// A7 坏形状一律不炸：cards 不是数组 / 空卡 / 重复 id / 怪条目
write(base({ enabled: true, text: '仍旧生效的形象。', cards: 'not-an-array' }))
out = text()
t('A7 cards 非数组不炸:', out.includes('仍旧生效的形象。') && !out.includes('【形象卡'))
write(base({
  enabled: true,
  cards: [{}, null, { id: 'x', title: '阿明', brief: '第一张' }, { id: 'x', brief: '重复 id 的第二张' }],
}))
out = text()
t('A7 空卡与重复 id:', out.includes('[x] 阿明 · 第一张') && !out.includes('重复 id 的第二张'))

// A8 on:false 的卡：常驻与目录都不出现
write(base({
  enabled: true,
  cards: [{ id: 'aming', who: 'user', title: '阿明', brief: '不该出现', on: false }],
}))
out = text()
t('A8 on:false 全不出现:', !out.includes('不该出现') && !out.includes('【形象卡') && !out.includes('【形象目录'))

// A9 未知子键原样透传（保存一次不许裁掉别人的键）
const merged = mergeConfig({ persona: { appearance: { enabled: true, weirdKey: 7, cards: [{ id: 'a', brief: 'b', extra: 'keep-me' }] } } })
t('A9 未知子键保留:', merged.persona.appearance.weirdKey === 7 && merged.persona.appearance.cards[0].extra === 'keep-me')

// A10 占位符：卡的 title / brief / detail 里都替换
writeFileSync(process.env.DSH_WHALE_CONFIG, JSON.stringify({
  enabled: true,
  persona: {
    enabled: true, selfNameFlash: '小助手', userName: '小林',
    appearance: { enabled: true, cards: [{ id: 'u', who: 'user', title: '{userName}本人', brief: '我是{selfName}记住的{userName}', detail: '{userName}的样子' }] },
  },
}), 'utf8')
out = text()
t('A10 占位符替换:', out.includes('- 小林本人：我是小助手记住的小林') && !out.includes('{userName}'))

// A11 照片路径最多列 3 条，其余用「等 N 张」收口
write(base({
  enabled: true,
  cards: [{ id: 'u', who: 'user', title: '阿明', brief: '三十岁', media: ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg'] }],
}))
out = text()
t('A11 media 上限:', out.includes('照片：a.jpg、b.jpg、c.jpg 等 5 张') && !out.includes('d.jpg'))

// A12 老路径不受影响：appearance.text + byModel 覆盖照旧（模型 id 来自 agent.options.model）
write(base({ enabled: true, text: '通用形象', byModel: { flash: 'flash 档专用形象' } }))
out = text({ session: { header: { id: 'test-appearance', cwd: 'D:/work/demo-project' } }, options: { model: 'deepseek-v4.1-flash' } })
t('A12 byModel 仍生效:', out.includes('flash 档专用形象') && !out.includes('通用形象'))

// A13 appearance.enabled=false：卡写了也不注入（opt-in 总闸优先）
write(base({ enabled: false, cards: [{ id: 'u', who: 'user', title: '阿明', brief: '不该出现' }] }))
out = text()
t('A13 总闸关:', !out.includes('不该出现'))

// A14 换预设不丢卡：预设没显式给 cards / index 时保留现场（卡是个人存档，不是内容包）
const { applyPresetToConfig } = await import('../core/presetStore.js')
const before = { persona: { appearance: { enabled: true, text: '老形象', cards: [{ id: 'u', brief: '存档的卡' }], index: false } } }
const after = applyPresetToConfig(before, { persona: { appearance: { enabled: true, text: '预设形象', byModel: {} } } })
t('A14 换预设不丢卡:', after.persona.appearance.text === '预设形象'
  && Array.isArray(after.persona.appearance.cards) && after.persona.appearance.cards[0].id === 'u'
  && after.persona.appearance.index === false)
const after2 = applyPresetToConfig(before, { persona: { appearance: { enabled: true, cards: [{ id: 'p', brief: '预设的卡' }] } } })
t('A14b 预设显式给卡以预设为准:', after2.persona.appearance.cards[0].id === 'p')

console.log('appearance 测试结束')
