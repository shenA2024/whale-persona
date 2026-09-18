// 人设引擎冒烟（2026-09-18 起用固定夹具，不再依赖真机配置）
import { writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = path.join(os.tmpdir(), 'whale-persona-smoke.json')
process.env.DSH_WHALE_CONFIG = tmp
writeFileSync(tmp, JSON.stringify({
  enabled: true,
  thinkingLanguage: 'zh-CN',
  persona: {
    enabled: true,
    selfNameFlash: '小助手', selfNamePro: '首席助手', userName: 'shenA2024',
    stance: '{userName}的编程搭档，直来直去。',
    character: '你是{selfName}，{userName}是对你重要的人。',
    suffix: '工作目录在 {{cwd}}。',
    contracts: [
      { id: 'finish-first', text: '一次做完：{userName}不喜欢被反复问。', on: true },
      { id: 'no-followup-question', text: '结尾不要出现征询式问句。', on: true },
      { text: '这条关了', on: false },
    ],
  },
  memory: { enabled: true, entries: [{ text: '{userName}喜欢先看证据', on: true }] },
}), 'utf8')

const { apply } = await import('../index.js')
const { renderPersona } = await import('../lib/render.js')
const { mergeConfig, DEFAULTS } = await import('../lib/defaults.js')

const reg = []
const ctx = { systemPrompt: { section(s) { reg.push(s); return () => {} } } }
const dispose = apply(ctx)

console.log('SEC1 sections:', reg.map((s) => s.name + '@' + s.order).join(' | '))
const prefix = reg.find((s) => s.name === 'deployment:persona-prefix')
const suffix = reg.find((s) => s.name === 'deployment:persona-suffix')
const think = reg.find((s) => s.name === 'deployment:thinking-language')

const flash = prefix.text({ agent: { options: { model: 'deepseek-v4.1-flash' } } })
const pro = prefix.text({ agent: { options: { model: 'deepseek-v4-pro' } } })
console.log('SEC2 flash/pro:', flash.includes('小助手'), '/', pro.includes('首席助手'))
console.log('SEC2 stance(渲染且在character前):', flash.includes('shenA2024的编程搭档，直来直去。')
  && flash.indexOf('shenA2024的编程搭档') < flash.indexOf('你是小助手'))
console.log('SEC2 契约填充:', flash.includes('shenA2024不喜欢被反复问') && !flash.includes('这条关了'))
console.log('SEC2 记忆块:', flash.includes('长期记忆') && flash.includes('shenA2024喜欢先看证据'))
console.log('SEC3 suffix({{cwd}}替换):', JSON.stringify(suffix.text({})))
console.log('SEC4 思维链语言段(zh):', think.text({}).includes('简体中文'))

// 开源通用默认值（2026-09-18）：纯引擎零观点（记忆流默认关）
const g = mergeConfig(null)
console.log('SEC5 通用默认:', g.persona.selfNameFlash === '我' && g.persona.userName === '用户'
  && g.persona.character === '' && g.persona.contracts.length === 0 && g.persona.suffix === ''
  && DEFAULTS.thinkingLanguage === 'off'
  && DEFAULTS.memory.enabled === false)
console.log('SEC5 通用渲染为空串(装上不改行为):', JSON.stringify(renderPersona(g, 'flash').slice(0, 8)))
// 补测：纯默认下完整 prefix 段（含入库纪律块）也为空——「装上不改变任何行为」的完整口径
writeFileSync(tmp, JSON.stringify({}), 'utf8')
console.log('SEC5b 纯默认完整prefix为空:', JSON.stringify(prefix.text({ agent: { options: { model: 'flash' } } })))
console.log('SEC5c 纯默认suffix段为空(零观点口径):', JSON.stringify(suffix.text({})))

// 总开关/人设开关
console.log('SEC7 master-off ->', JSON.stringify(renderPersona(mergeConfig({ enabled: false }), 'flash').slice(0, 8)))
console.log('SEC7 persona-off ->', JSON.stringify(renderPersona(mergeConfig({ persona: { enabled: false } }), 'flash').slice(0, 8)))
console.log('SEC10 dispose:', typeof dispose === 'function')
