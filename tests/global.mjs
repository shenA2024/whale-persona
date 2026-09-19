// 全局入口冒烟（0.9.2）：段名必须是自有名（不占官方具名槽位），渲染与 preset 入口同源同结果。
// 断言强制：false 即非零退出（跑器只认非零退出/FAIL 字样）。
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const home = mkdtempSync(path.join(os.tmpdir(), 'whale-persona-global-'))
process.env.DSH_HOME = home
process.env.DSH_WHALE_CONFIG = path.join(home, 'config.json')
writeFileSync(process.env.DSH_WHALE_CONFIG, JSON.stringify({
  enabled: true,
  thinkingLanguage: 'zh-CN',
  persona: {
    enabled: true, selfNameFlash: '小助手', userName: '小林',
    character: '你是{selfName}，{userName}的搭档。',
    suffix: '工作目录在 {{cwd}}。',
    contracts: [{ id: 'c1', text: '先给结论再展开。', on: true }],
  },
  memory: { enabled: true, entries: [{ text: '交付用简体中文。', on: true }] },
}), 'utf8')

const t = (name, ok) => {
  console.log(name + ':', ok)
  if (!ok) process.exitCode = 1
}

const { apply: applyGlobal, name: gname } = await import('../adapters/dsh/global.js')
const { apply: applyPreset, name: pname } = await import('../adapters/dsh/index.js')

const regG = []
applyGlobal({ systemPrompt: { section(s) { regG.push(s); return () => {} } } })
const gnames = regG.map((s) => s.name)
console.log('G1 sections:', regG.map((s) => s.name + '@' + s.order).join(' | '))

t('G1 三段注册齐:', regG.length === 3)
t('G1 不占任何官方具名槽位:', gnames.every((n) => !String(n).startsWith('deployment:')))
const gPrefix = regG.find((s) => s.name === 'whale:persona-global')
const gSuffix = regG.find((s) => s.name === 'whale:persona-global-suffix')
const gThink = regG.find((s) => s.name === 'whale:global-thinking-language')
t('G2 段名齐:', !!(gPrefix && gSuffix && gThink))
t('G3 order 紧随官方段(1 / 21 / 10201):', gPrefix.order === 1 && gThink.order === 21 && gSuffix.order === 10201)
t('G4 插件名带 /global:', gname === '@shenA2024/whale-persona/global')

const text = gPrefix.text({ agent: { options: { model: 'deepseek-v4.1-flash' } } })
t('G5 人设真的渲染出来:', text.includes('小助手') && text.includes('先给结论再展开') && text.includes('交付用简体中文'))
t('G6 后缀段 {{cwd}} 替换:', gSuffix.text({ agent: { session: { header: { cwd: 'D:/demo' } } } }).includes('D:/demo'))
t('G7 思维链语言段:', gThink.text({}).includes('简体中文'))

// 对照：preset 入口仍占官方槽位 —— 两个入口的差别**只在段名**
const regP = []
applyPreset({ systemPrompt: { section(s) { regP.push(s); return () => {} } } })
const pnames = regP.map((s) => s.name)
t('G8 preset 入口仍占官方槽位:', pnames.includes('deployment:persona-prefix') && pnames.includes('deployment:persona-suffix'))
t('G9 两入口段名零交集(不会互相遮蔽):', pnames.every((n) => !gnames.includes(n)))
t('G10 preset 入口名不含 /global:', pname === '@shenA2024/whale-persona')
