// 人设引擎冒烟（2026-09-18 起用固定夹具，不再依赖真机配置；断言强制——false 即非零退出）
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// 夹具隔离：DSH_HOME 指向临时目录，测试不读真机的配置与收件箱
const home = mkdtempSync(path.join(os.tmpdir(), 'whale-persona-smoke-'))
const tmp = path.join(home, 'config.json')
process.env.DSH_HOME = home
process.env.DSH_WHALE_CONFIG = tmp
writeFileSync(tmp, JSON.stringify({
  enabled: true,
  thinkingLanguage: 'zh-CN',
  persona: {
    enabled: true,
    selfNameFlash: '小助手', selfNamePro: '首席助手', userName: '小林',
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

// 断言助手：跑器只认非零退出或 FAIL 字样，纯 console.log 会漏放坏改（黑屏事故教训）
const t = (name, ok) => {
  console.log(name + ':', ok)
  if (!ok) process.exitCode = 1
}

const { apply } = await import('../adapters/dsh/index.js')
const { renderPersona } = await import('../core/render.js')
const { mergeConfig, DEFAULTS } = await import('../core/defaults.js')

const reg = []
const ctx = { systemPrompt: { section(s) { reg.push(s); return () => {} } } }
const dispose = apply(ctx)

console.log('SEC1 sections:', reg.map((s) => s.name + '@' + s.order).join(' | '))
const prefix = reg.find((s) => s.name === 'deployment:persona-prefix')
const suffix = reg.find((s) => s.name === 'deployment:persona-suffix')
const think = reg.find((s) => s.name === 'whale:thinking-language')
t('SEC1 三段注册齐:', !!(prefix && suffix && think))

const flash = prefix.text({ agent: { options: { model: 'deepseek-v4.1-flash' } } })
const pro = prefix.text({ agent: { options: { model: 'deepseek-v4-pro' } } })
t('SEC2 flash/pro 分档:', flash.includes('小助手') && pro.includes('首席助手'))
t('SEC2 stance(渲染且在character前):', flash.includes('小林的编程搭档，直来直去。')
  && flash.indexOf('小林的编程搭档') < flash.indexOf('你是小助手'))
t('SEC2 契约填充:', flash.includes('小林不喜欢被反复问') && !flash.includes('这条关了'))
t('SEC2 记忆块:', flash.includes('长期记忆') && flash.includes('小林喜欢先看证据'))
t('SEC3 suffix({{cwd}}替换):', suffix.text({}).includes('工作目录在'))
t('SEC4 思维链语言段(zh):', think.text({}).includes('简体中文'))

// 开源通用默认值（2026-09-18）：纯引擎零观点（记忆流默认关）
const g = mergeConfig(null)
t('SEC5 通用默认:', g.persona.selfNameFlash === '我' && g.persona.userName === '用户'
  && g.persona.character === '' && g.persona.contracts.length === 0 && g.persona.suffix === ''
  && DEFAULTS.thinkingLanguage === 'off'
  && DEFAULTS.memory.enabled === false)
console.log('SEC5 通用渲染(装上不改行为):', JSON.stringify(renderPersona(g, 'flash').slice(0, 8)))
// 补测：纯默认下完整 prefix 段（含入库纪律块）也为空——「装上不改变任何行为」的完整口径
writeFileSync(tmp, JSON.stringify({}), 'utf8')
t('SEC5b 纯默认完整prefix为空:', prefix.text({ agent: { options: { model: 'flash' } } }) === '')
t('SEC5c 纯默认suffix段为空(零观点口径):', suffix.text({}) === '')

// 总开关/人设开关
t('SEC7 master-off 渲染为空:', renderPersona(mergeConfig({ enabled: false }), 'flash') === '')
t('SEC7 persona-off 渲染为空:', renderPersona(mergeConfig({ persona: { enabled: false } }), 'flash') === '')
t('SEC10 dispose:', typeof dispose === 'function')

// SEC11 收口开关：默认按需（会话级）／开了才生效／always 是旧行为
{
  const { captureActive, setOn, isOn } = await import('../core/capture.js')
  const a = { options: { model: 'flash' }, session: { header: { id: 's-smoke' } } }
  const onDemand = mergeConfig({ memory: { enabled: true, inbox: true } })
  t('SEC11 默认模式 on-demand:', DEFAULTS.memory.capture === 'on-demand')
  t('SEC11 默认关:', captureActive(onDemand, a) === false && isOn(a) === false)
  setOn(a, true)
  t('SEC11 开关打开后生效:', captureActive(onDemand, a) === true)
  t('SEC11 always 模式:', captureActive(mergeConfig({ memory: { enabled: true, inbox: true, capture: 'always' } }), a) === true)
  t('SEC11 inbox 关则不开:', captureActive(mergeConfig({ memory: { enabled: true, inbox: false, capture: 'always' } }), a) === false)
  t('SEC11 memory 关则不开:', captureActive(mergeConfig({ memory: { enabled: false, capture: 'always' } }), a) === false)
}
// SEC12 /memory 命令注册：拿到 commands 服务就注册；没拿到只影响命令，人设照常
{
  const regs = []
  const fibers = []
  const fakeCtx = {
    systemPrompt: { section: () => () => {} },
    inject: (deps, cb) => {
      cb({ commands: { register: (def) => { regs.push(def); return () => {} } } })
      const f = { dispose() {} }
      fibers.push(f)
      return f
    },
  }
  const d = apply(fakeCtx)
  const cmd = regs.find((r) => r.name === 'memory')
  t('SEC12 /memory 注册:', !!cmd && typeof cmd.handler === 'function' && typeof d === 'function')
  const res = cmd.handler({ agent: { session: { header: { id: 'cmd-session' } } }, rawInput: 'status' })
  t('SEC12 处理器可执行:', !!res && typeof res.kind === 'string' && typeof res.text === 'string')
  d()
  t('SEC12 dispose 不抛错:', true)
}
