#!/usr/bin/env node
/**
 * 注入体积体检（0.13.0）
 *
 * 为什么有它：本插件一直在讲"省 token"，但在此之前用户**看不见**自己这份人设每轮注入多少。
 * 这条命令把 core/measure.js 的计量端出来：每段多少字符、合计多少、是否超预算。
 * 与设置面板、运行期注入**同一套渲染通道**（不是另算一份近似值），对得上是对得上，不是估的。
 *
 * 用法（DSH_HOME / DSH_WHALE_CONFIG 决定读哪份配置；默认 ~/.dsh）：
 *   node scripts/inject-size.mjs                     # 用上次会话真实用的模型（last-model.json）计量
 *   node scripts/inject-size.mjs --tier pro          # 强制按 pro 档渲染（默认 flash 档）
 *   node scripts/inject-size.mjs --model glm-5.1     # 指定模型 id（影响自称/形象/语气的按模型覆盖）
 *   node scripts/inject-size.mjs --cwd D:/<private-repo>   # 指定工作目录（影响收件箱 tag 相关性选择）
 *   node scripts/inject-size.mjs --capture on        # 当作「本会话已 /memory on」计量（默认按配置口径）
 *   node scripts/inject-size.mjs --json              # 机器可读
 *
 * 只读：本命令不写配置、不写收件箱，只看。
 */
import { configPath, createStore } from '../core/store.js'
import { measureInjection } from '../core/measure.js'
import { readLastModel } from '../core/lastModel.js'
import { captureMode } from '../core/capture.js'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf('--' + name)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback
}
const json = argv.includes('--json')

const store = createStore()
const cfg = store.get()
const tier = String(flag('tier', '')).toLowerCase() === 'pro' ? 'pro' : 'flash'
// 面板与 CLI 都优先用"上次真实注入用的模型 id"：界面上的显示名通常不是它（见 core/lastModel.js）
const last = readLastModel()
const model = String(flag('model', last || (tier === 'pro' ? 'pro' : 'flash')))
const cwd = String(flag('cwd', process.cwd()))
const captureArg = String(flag('capture', '')).toLowerCase()
const capture = captureArg === 'on' ? true : captureArg === 'off' ? false : captureMode(cfg) === 'always'

const m = measureInjection(cfg, { model, cwd, capture })

if (json) {
  console.log(JSON.stringify({ configPath: configPath(), model, cwd, capture, ...m }, null, 2))
} else {
  console.log('配置文件：' + configPath().replace(/\\/g, '/'))
  console.log('模型    ：' + model + '（' + (last && model === last ? '上次会话真实使用' : '按参数/档位推定') + '）')
  console.log('工作目录：' + cwd.replace(/\\/g, '/') + '（收件箱 tag 相关性按它判定）')
  console.log('收口开关：' + (capture ? '本会话视为已开（会注入【入库纪律】）' : '未开（【入库纪律】不注入）'))
  console.log('')
  const pct = (n) => (m.total ? String(Math.round((n / m.total) * 1000) / 10) + '%' : '0%')
  console.log('段落'.padEnd(14, ' ') + '字符'.padStart(8, ' ') + '  占比')
  for (const p of m.parts) console.log(p.label.padEnd(14, ' ') + String(p.chars).padStart(8, ' ') + '  ' + pct(p.chars))
  console.log('-'.repeat(30))
  console.log('合计'.padEnd(14, ' ') + String(m.total).padStart(8, ' '))
  const b = m.budget
  if (!b.enabled) console.log('预算：未启用（budget.enabled=false）—— 想要超限提醒就把 budget.enabled 设为 true 并给 max')
  else if (!b.max) console.log('预算：已启用但 max 为 0（= 不设上限），只计量不提醒')
  else if (b.over) console.log('预算：超限！' + m.total + ' / ' + b.max + ' 字符（超出 ' + (m.total - b.max) + '）' + (b.note ? '；提醒行已注入末尾段' : '（warnInPrompt=false，只在这里报）'))
  else console.log('预算：' + m.total + ' / ' + b.max + ' 字符，余量 ' + (b.max - m.total))
}
