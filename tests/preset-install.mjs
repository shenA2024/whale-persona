// Agent 预设安装语义（core/presetInstall.js，2026-09-29 / 0.17.3 新增）
//
// 触发来源：插件市场与 `dsh plugin add` 只把包挂进 profile 平面，**不建 agent preset** ——
// 用户装完的观感是「插件装了、面板在、人设不生效」。0.17.3 把这段逻辑从安装脚本里提出来，
// 给「安装脚本」与「设置面板」共用一份；两份实现必然漂移，而这里漂移的代价是
// "面板说建好了、宿主不认"。所以判据钉在这份实现上（面板路由侧的判据在 tests/ui-panel.mjs）。
//
// 断言强制：任一 false 即非零退出（与 smoke.mjs 同一约定）。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const home = mkdtempSync(path.join(os.tmpdir(), 'whale-persona-preset-'))
process.env.DSH_HOME = home

// 造一个"宿主自带 preset"的根：<root>/@deepseek-ai/dsh-agent-presets/presets/standard/
// 为什么用 DSH_AGENT_PRESETS_ROOT：candidateRoots() 把它排在第一位，于是这份夹具
// 压过真机上的 npm 全局目录 —— 测试在任何机器上看到的是同一颗基座，不会因为"这台机器装了什么"而变。
const srcRoot = mkdtempSync(path.join(os.tmpdir(), 'whale-persona-preset-src-'))
const shipped = path.join(srcRoot, '@deepseek-ai', 'dsh-agent-presets', 'presets')
mkdirSync(path.join(shipped, 'standard'), { recursive: true })
writeFileSync(path.join(shipped, 'standard', 'agent.cordis.yml'),
  '# 宿主出厂 standard\n'
  + '- id: persona\n'
  + "  name: '@deepseek-ai/dsh-persona'\n"
  + '  config:\n'
  + '    keep: 1\n'
  + '\n'
  + '- id: tools\n'
  + "  name: '@deepseek-ai/dsh-tools'\n", 'utf8')
writeFileSync(path.join(shipped, 'standard', 'preset.yml'), 'name: 标准模式\n', 'utf8')
process.env.DSH_AGENT_PRESETS_ROOT = srcRoot

const {
  PRESET_ID, PRESET_NAME, LEGACY_PERSONA_PKG,
  presetDir, agentFile, presetState, installPreset, setDefaultPreset, shippedPresetsRoot,
} = await import('../core/presetInstall.js')

const t = (name, ok) => { console.log(name + ':', ok); if (!ok) process.exitCode = 1 }
const read = (f) => readFileSync(f, 'utf8')
const DIR = presetDir(home)
const AGENT = agentFile(home)

t('A1 夹具：能看见自带的基座 preset 根', shippedPresetsRoot(home) === shipped)

// ── 找不到基座时：不建半个东西，且给出手工做法 ───────────────────────────────
const noBase = installPreset({ home, base: 'no-such-preset' })
t('A2 基座缺失 → ok=false / action=no-base', noBase.ok === false && noBase.action === 'no-base')
t('A2b 基座缺失时不建目录（不留半个预设）', !existsSync(DIR))
t('A2c 基座缺失时给手工做法（含复制目标路径）',
  noBase.messages.some((m) => m.indexOf('复制到') >= 0 && m.indexOf(DIR) >= 0))

// ── dry-run：只说不做 ────────────────────────────────────────────────────────
const dry = installPreset({ home, dryRun: true })
t('A3 dry-run → action=dry', dry.ok === true && dry.action === 'dry')
t('A3b dry-run 一个字节都不改盘', !existsSync(DIR) && !existsSync(AGENT))
t('A3c dry-run 的文案带 DRY 前缀', dry.messages.some((m) => m.indexOf('DRY:') === 0))

// ── 建：基座整段换人设行 ─────────────────────────────────────────────────────
const made = installPreset({ home })
t('A4 建 preset → action=created / 基座跟随默认', made.ok === true && made.action === 'created' && made.baseId === 'standard')
const agentText = read(AGENT)
t('A4b 人设行换成我们这行', /^- id: whale-persona$/m.test(agentText) && /name: 'whale-persona'/.test(agentText))
t('A4c 官方 persona 行整段被换掉（连它的 config 子键一起，不留半行）',
  agentText.indexOf('@deepseek-ai/dsh-persona') < 0 && agentText.indexOf('keep: 1') < 0)
t('A4d 基座里的其它行照旧', /^- id: tools$/m.test(agentText) && agentText.indexOf('@deepseek-ai/dsh-tools') > 0)
t('A4e preset.yml 写上显示名', new RegExp('^name: ' + PRESET_NAME + '$', 'm').test(read(path.join(DIR, 'preset.yml'))))
t('A4f 状态转 healthy', presetState(home).installed === true && presetState(home).hasPersonaRow === true)

// ── 幂等：重装不推平用户改过的东西 ───────────────────────────────────────────
writeFileSync(path.join(DIR, 'preset.yml'), 'name: 我的鲸鱼\n', 'utf8')
writeFileSync(AGENT, agentText.replace('- id: tools', '- id: my-extra\n  name: \'mine\'\n\n- id: tools'), 'utf8')
const again = installPreset({ home })
t('A5 再建 → action=kept（不重新复制基座）', again.ok === true && again.action === 'kept')
t('A5b 用户改过的显示名保留', read(path.join(DIR, 'preset.yml')).indexOf('name: 我的鲸鱼') >= 0)
t('A5c 用户加的自定义行保留', read(AGENT).indexOf('- id: my-extra') >= 0)
t('A5d presetState.displayName 读的是用户改过的那个', presetState(home).displayName === '我的鲸鱼')

// ── 旧包名迁移（新名是旧名的子串，所以必须先认旧名）──────────────────────────
writeFileSync(AGENT, read(AGENT).replace("name: 'whale-persona'", "name: '" + LEGACY_PERSONA_PKG + "'"), 'utf8')
const legacyState = presetState(home)
t('A6 旧包名被认出来（legacy=true，且仍算 healthy）', legacyState.legacy === true && legacyState.hasPersonaRow === true)
const mig = installPreset({ home })
t('A6b 就地改名迁移并报出这句话', mig.messages.some((m) => m.indexOf('旧包名就地换成') >= 0))
t('A6c 盘上不再有旧 scope', read(AGENT).indexOf('@shenA2024/') < 0 && read(AGENT).indexOf("name: 'whale-persona'") > 0)
t('A6d 迁移算 kept（旧预设本来就是我们的，不该被基座覆盖）', mig.action === 'kept')

// ── 路径穿越：基座 id 不是目录名就拒 ─────────────────────────────────────────
// 注意必须用一个**还没有 preset** 的 home：上面的 home 里 preset 已存在时走的是 kept 分支，
// base 参数根本不会被用到 —— 那样测出来的是"什么也没发生"，不是"越界被拒"。
const home2 = mkdtempSync(path.join(os.tmpdir(), 'whale-persona-preset-evil-'))
const evil = installPreset({ home: home2, base: '../../evil' })
t('A7 越界基座 id → 拒（ok=false）', evil.ok === false && evil.action === 'no-base')
t('A7b 越界尝试不留目录', !existsSync(presetDir(home2)))

// ── 默认 preset：只在空/已是自己时写，用户另有选择就不动 ──────────────────────
const d1 = setDefaultPreset({ home })
t('A8 没设过默认 → 写成本插件', d1.ok === true && d1.changed === true && presetState(home).isDefault === true)
const d1b = setDefaultPreset({ home })
t('A8b 已经是自己 → 幂等，不重复写', d1b.ok === true && d1b.changed === false)
writeFileSync(path.join(home, 'settings.yaml'), 'agent-presets:\n  default: computer-use\n', 'utf8')
const d2 = setDefaultPreset({ home })
t('A9 用户另有默认 → 拒绝并说清原因', d2.ok === false && d2.reason.indexOf('没动它') >= 0)
t('A9b 拒绝时盘上真的是别人的默认', read(path.join(home, 'settings.yaml')).indexOf('default: computer-use') > 0)
rmSync(path.join(home, 'settings.yaml'), { force: true })
const d3 = setDefaultPreset({ home, dryRun: true })
t('A10 dry-run → 只报会写什么，不落盘', d3.ok === true && d3.changed === true && !existsSync(path.join(home, 'settings.yaml')))
t('A10b dry-run 文案带 DRY', d3.reason.indexOf('DRY') >= 0)

// ── settings.yaml 已有别的键时，只动 agent-presets.default 那一行 ──────────────
writeFileSync(path.join(home, 'settings.yaml'), 'model: x\nagent-presets:\n  extra: y\n\nother: z\n', 'utf8')
setDefaultPreset({ home })
const sy = read(path.join(home, 'settings.yaml'))
t('A11 只插一行 default，别处原样', sy.indexOf('model: x') >= 0 && sy.indexOf('extra: y') >= 0 && sy.indexOf('other: z') >= 0 && sy.indexOf('default: whale-persona') > 0)

console.log('---- preset-install 读数 ----')
console.log('home =', home)
console.log('presetId =', PRESET_ID, '· 显示名 =', PRESET_NAME, '· 目录 =', DIR)
