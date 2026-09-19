// 酒馆卡映射冒烟（0.10.0）：认得准 / 映射对 / 不承接的字段点名 / 往返保真 / 垃圾输入不许猜
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const home = mkdtempSync(path.join(os.tmpdir(), 'whale-persona-tavern-'))
process.env.DSH_HOME = home

const t = (name, ok) => {
  console.log(name + ':', ok)
  if (!ok) process.exitCode = 1
}

const T = await import('../core/tavernCard.js')

// ── 认得准 ──────────────────────────────────────────────────────────────
const v2 = {
  spec: 'chara_card_v2', spec_version: '2.0',
  data: {
    name: 'Aurora the Archivist', description: '一位沉默的档案管理员。', personality: '谨慎、话少、只讲证据。',
    scenario: '在一座会自己生长的图书馆里。', first_mes: '「你来了。」', mes_example: '<START>',
    system_prompt: '- 先给结论，再给依据。\n- 不确定的事直接说不确定。', post_history_instructions: '结尾不要反问。',
    creator_notes: '备注', character_book: { entries: [] }, tags: ['助手', '档案'], creator: 'someone', character_version: '2.1',
    alternate_greetings: ['你好'],
  },
}
t('T1 认 v2:', T.detectCard(v2) === 'tavern-v2')
t('T1 认 v1:', T.detectCard({ name: 'Old', description: 'x', first_mes: 'hi' }) === 'tavern-v1')
t('T1 认自家预设:', T.detectCard({ spec: 'whale-persona-preset/1', persona: { character: 'x' } }) === 'whale-preset')
t('T1 认不出就不认:', T.detectCard({ a: 1 }) === 'unknown' && T.detectCard(null) === 'unknown')

// ── 映射 ────────────────────────────────────────────────────────────────
const imp = T.fromTavern(v2)
t('T2 有结果:', !!imp && !!imp.preset)
t('T2 label/author/tags:', imp.preset.label === 'Aurora the Archivist' && imp.preset.author === 'someone' && imp.preset.tags.length === 2)
t('T2 id 是安全 slug:', imp.preset.id === 'aurora-the-archivist')
t('T2 description→character:', imp.preset.persona.character.includes('沉默的档案管理员'))
t('T2 scenario 追加在 character 里:', imp.preset.persona.character.includes('会自己生长的图书馆'))
t('T2 personality→stance:', imp.preset.persona.stance === '谨慎、话少、只讲证据。')
t('T2 system_prompt→两条契约:', Array.isArray(imp.preset.persona.contracts) && imp.preset.persona.contracts.length === 2
  && imp.preset.persona.contracts[0].text === '先给结论，再给依据。')
t('T2 post_history_instructions→suffix:', imp.preset.persona.suffix === '结尾不要反问。')
t('T2 列表符号已剥掉:', imp.preset.persona.contracts.every((c) => !/^[-*•]/.test(c.text)))

// ── 不承接的字段必须点名 ────────────────────────────────────────────────
const un = imp.unmapped.join(',')
t('T3 first_mes 点名:', un.includes('first_mes'))
t('T3 mes_example 点名:', un.includes('mes_example'))
t('T3 character_book 点名:', un.includes('character_book'))
t('T3 alternate_greetings 点名:', un.includes('alternate_greetings'))
t('T3 报告里说明不承接:', imp.notes.some((n) => n.includes('不承接')))

// ── 单行超长的 system_prompt：必须断句兜底，且丢光时不许谎报映射成功（0.11.0）──
const longLine = '你是一个耐心的助手。先给结论再给依据！不确定就说不确定？不要编造任何事实。'.repeat(12) // 无换行、远超 300 字
const impLong = T.fromTavern({ spec: 'chara_card_v2', data: { name: 'LongPrompt', description: 'd', system_prompt: longLine } })
t('T4 单行超长 system_prompt 断句兜底（>=2 条契约）:', !!impLong && Array.isArray(impLong.preset.persona.contracts) && impLong.preset.persona.contracts.length >= 2)
t('T4 断出来的每条都短于上限:', !!impLong && impLong.preset.persona.contracts.every((c) => c.text.length <= 300))
const gibberish = 'x'.repeat(500) // 无标点、无换行：断不出任何可执行的行
const impDead = T.fromTavern({ spec: 'chara_card_v2', data: { name: 'Dead', description: 'd', system_prompt: gibberish } })
t('T5 断不出契约时不写 contracts:', !!impDead && !impDead.preset.persona.contracts)
t('T5 并且不谎报映射成功:', !!impDead && !impDead.mapped.some((m) => m.includes('system_prompt')))
t('T5 并在 unmapped 里点名:', !!impDead && impDead.unmapped.some((u) => u.includes('system_prompt')))

// ── 往返保真 ────────────────────────────────────────────────────────────
const preset = {
  id: 'rt', label: '往返人格', author: 'me', tags: ['x'], thinkingLanguage: 'zh-CN',
  persona: {
    userName: '小林', selfNameFlash: '小助手', selfNamePro: '首席助手',
    selfNameByModel: { 'glm-5.1': '小五' }, stance: '搭档。', character: '你是{selfName}。',
    suffix: '工作目录在 {{cwd}}。', contracts: [{ id: 'a', text: '先给结论。', on: true }, { id: 'b', text: '关掉的', on: false }],
    tone: { enabled: true, text: '干脆', byModel: {} }, appearance: { enabled: false, text: '', byModel: {} },
  },
}
const card = T.toTavern(preset)
// v2 规范的 spec/spec_version 在**顶层**（与 data 平级）——照规范写，别凭印象
t('T4 导出是 v2 卡:', card.spec === 'chara_card_v2' && card.spec_version === '2.0' && !!card.data)
t('T4 说明写在 creator_notes:', String(card.data.creator_notes).includes('extensions.whale_persona'))
t('T4 只导出开着的契约:', card.data.system_prompt.includes('先给结论') && !card.data.system_prompt.includes('关掉的'))
const back = T.fromTavern(card)
t('T4 往返 character:', back.preset.persona.character === '你是{selfName}。')
t('T4 往返 stance:', back.preset.persona.stance === '搭档。')
t('T4 往返 suffix:', back.preset.persona.suffix === '工作目录在 {{cwd}}。')
t('T4 往返独有字段:', back.preset.persona.userName === '小林' && back.preset.persona.selfNamePro === '首席助手'
  && back.preset.persona.selfNameByModel['glm-5.1'] === '小五' && back.preset.thinkingLanguage === 'zh-CN')
t('T4 往返 tone:', back.preset.persona.tone.text === '干脆')
t('T4 往返契约条数:', back.preset.persona.contracts.length === 1)

// ── id 兜底：中文卡名不能全撞成一个 ──────────────────────────────────────
const a = T.slugId('小樱')
const b = T.slugId('林深见鹿')
t('T5 中文名有兜底 id:', !!a && a.startsWith('card-') && a !== b)
t('T5 同一个中文名稳定:', T.slugId('小樱') === a)
t('T5 英文名走 slug:', T.slugId('My Cool Card!') === 'my-cool-card')

// ── 垃圾输入：不猜 ──────────────────────────────────────────────────────
t('T6 垃圾 JSON 返回 null:', T.fromTavern('{ not json') === null && T.fromTavern({ a: 1 }) === null && T.fromTavern(123) === null)
t('T6 字符串形式的卡照样认:', !!T.fromTavern(JSON.stringify(v2)))
