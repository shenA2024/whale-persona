// Agent 预设安装语义（core/presetInstall.js，2026-09-29 / 0.17.3 新增）
//
// 触发来源：插件市场与 `dsh plugin add` 只把包挂进 profile 平面，**不建 agent preset** ——
// 用户装完的观感是「插件装了、面板在、人设不生效」。0.17.3 把这段逻辑从安装脚本里提出来，
// 给「安装脚本」与「设置面板」共用一份；两份实现必然漂移，而这里漂移的代价是
// "面板说建好了、宿主不认"。所以判据钉在这份实现上（面板路由侧的判据在 tests/ui-panel.mjs）。
//
// 断言强制：任一 false 即非零退出（与 smoke.mjs 同一约定）。
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const home = mkdtempSync(path.join(os.tmpdir(), 'whale-persona-preset-'))
process.env.DSH_HOME = home
// 夹具卫生（2026-10-16）：DSH_* 是**继承环境**——在 DSH 会话里跑测试时，进程环境里带着真实的
// DSH_PROFILE / DSH_PROFILE_NAME，`currentProfileName()` 会读到它，于是"这个 home 没有 profile 名"
// 的夹具被污染（DP7b 因此以为自己是 profile 平面、DP8 的判平面也跟着漂）。清掉，夹具才自己说了算。
delete process.env.DSH_PROFILE
delete process.env.DSH_PROFILE_NAME

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
  detectPresetPlane, shippedPatchPreset, basePresetSource, isDesktopHost, parsePatchPresets,
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

// ── 两套 preset 机制（0.17.5）：桌面版走 profile 组合，根本不认 .agent-presets ─────────
// 触发来源 2026-09-29 真机：面板量的是 .agent-presets 平面，而桌面版实际用的是 profile 平面
// （`cordis.patch.yml` 的 agent-preset-registry + 一个 insert 块），于是"就绪/缺一步"都对不上真相。
// 夹具照真机形状造：desktop 的 patch.yml 里 L82 registry 段、L91 insert、L100 人设行。
const home3 = mkdtempSync(path.join(os.tmpdir(), 'whale-persona-plane-'))
const pdir = path.join(home3, 'profiles', 'desktop')
mkdirSync(pdir, { recursive: true })
const PATCH = path.join(pdir, 'cordis.patch.yml')
writeFileSync(PATCH,
  '- id: some-tool\n'
  + '  name: "@deepseek-ai/dsh-some-tool"\n'
  + '- id: agent-preset-registry\n'
  + '  name: "@deepseek-ai/dsh-agent-preset-registry"\n'
  + '  config:\n'
  + '    default: standard\n'
  + '    selectedDefault: whale\n'
  + '- insert:\n'
  + '    - id: preset-whale\n'
  + '      name: "@deepseek-ai/dsh-agent-preset"\n'
  + '      config:\n'
  + '        id: whale\n'
  + '        name: 自定义人设\n'
  + '        description: 基于 standard 模式 + whale-persona 人设引擎\n'
  + '        order: 9\n'
  + '        plugins:\n'
  + '          - id: whale-persona\n'
  + "            name: 'whale-persona'\n"
  + '\n'
  + '          - id: tool-pwsh\n'
  + "            name: '@deepseek-ai/dsh-tool-pwsh'\n", 'utf8')

// 宿主 argv 里带着 profile 目录 —— 真机上桌面版命令行就是这样（实测：… dsh … <DSH_HOME>\profiles\desktop …）
const realArgv = process.argv.slice()
process.argv = realArgv.concat([pdir])

const plane = detectPresetPlane(home3)
t('DP1 认出 profile 平面（patch.yml 里有 agent-preset-registry）', plane.plane === 'profile' && plane.profileName === 'desktop')
t('DP1b 认不出时按传统平面兜底（不给假结论）', detectPresetPlane(home).plane === 'agent-presets')
const ps = presetState(home3)
t('DP2 profile 平面读数：人设在、且算作新任务默认',
  ps.plane === 'profile' && ps.installed === true && ps.hasPersonaRow === true && ps.isDefault === true)
t('DP2b 显示名与预设 id 都从组合里读（不是 .agent-presets 那套）',
  ps.displayName === '自定义人设' && ps.presetIdInPlane === 'whale' && ps.defaultPresetId === 'whale' && ps.dir === PATCH)
t('DP2c 位置指向 profile 组合文件本身（面板显示的就是这一条）', ps.patchFile === PATCH)
const ip = installPreset({ home: home3 })
t('DP3 profile 平面已就绪 → kept，且不动宿主组合',
  ip.ok === true && ip.action === 'kept' && read(PATCH).indexOf('preset-whale') > 0)
const sd = setDefaultPreset({ home: home3 })
t('DP4 默认已是它 → 幂等不写', sd.ok === true && sd.changed === false)
// 缺人设行：0.17.7 起不再"只读 + 报路"，而是**真写进去** —— 判据跟着变成
// 「纯追加 / 写前备份 / 块形状照真机 / 写完读数就绪 / 再点幂等」这五件事。
// （要连它的 name 行一起删 —— 只删 `- id:` 那行的话，剩下的 name: 'whale-persona' 仍会被认出来）
writeFileSync(PATCH, read(PATCH).replace("          - id: whale-persona\n            name: 'whale-persona'\n", ''), 'utf8')
const before = read(PATCH)
const sd2 = setDefaultPreset({ home: home3 })
t('DP5 人设没挂上时不改默认（顺序：先挂上再设默认）', sd2.ok === false && sd2.reason.indexOf('先挂上') >= 0)
const ip2 = installPreset({ home: home3 })
t('DP5b 缺人设行 → 真写进 profile 组合（action=created，人设行来自基座克隆）',
  ip2.ok === true && ip2.action === 'created' && ip2.swapped === true)
const after5 = read(PATCH)
t('DP5c 纯追加：原有内容逐字保留在文件开头（绝不重排既有行）', after5.indexOf(before) === 0)
t('DP5d 写前备份了原文（备份文件内容 === 写前的组合）',
  !!ip2.backup && existsSync(ip2.backup) && readFileSync(ip2.backup, 'utf8') === before)
t('DP5e 追加的块照真机形状：insert + config.id + 10 格缩进的人设行 + 连工具行一起搬',
  after5.indexOf('- insert:', before.length) >= 0
  && after5.indexOf('        id: ' + PRESET_ID, before.length) >= 0
  && after5.indexOf('          - id: ' + PRESET_ID, before.length) >= 0
  && after5.slice(before.length).indexOf('@deepseek-ai/dsh-tools') >= 0)
t('DP5f 写入后读数立刻变就绪（不用刷两次）', presetState(home3).hasPersonaRow === true && presetState(home3).presetIdInPlane === PRESET_ID)
const ip3 = installPreset({ home: home3 })
t('DP5g 再点一次幂等：kept，不会再追加第二块',
  ip3.ok === true && ip3.action === 'kept' && read(PATCH) === after5)
const sd3 = setDefaultPreset({ home: home3 })
t('DP5h 组合里已有别的默认（selectedDefault: whale）→ 挂上人设也不抢它',
  sd3.ok === false && sd3.changed === false && sd3.reason.indexOf('已有默认') >= 0
  && read(PATCH).indexOf('selectedDefault: whale') > 0)

// ── 0.2.0-rc.2 的出厂预设换了形态（2026-10-15，触发来源：issue #2 / kaiye2343）──────────
// 出厂预设从 `<根>/@deepseek-ai/dsh-agent-presets/presets/<id>/agent.cordis.yml`
// 迁到 `<根>/@deepseek-ai/dsh-web-app/presets/<id>.patch.yml`（`- insert:` 外壳 + `preset-*` 项 + `plugins:`）。
// 旧实现只认前者：轻则报 no-base，重则把 npm 全局残留里那份 0.1.x 的插件面克隆进 0.2.x 的组合。
// 夹具照 0.2.0-rc.2 真机形状造（本机 asar 内 standard.patch.yml 7511 B，缩进：insert 0 / preset 4 / config 6 / plugins 8 / 插件行 10）。
const srcRoot2 = mkdtempSync(path.join(os.tmpdir(), 'whale-persona-preset-src2-'))
const shippedPatchRoot = path.join(srcRoot2, '@deepseek-ai', 'dsh-web-app', 'presets')
mkdirSync(shippedPatchRoot, { recursive: true })
const SHIPPED_PATCH = path.join(shippedPatchRoot, 'standard.patch.yml')
writeFileSync(SHIPPED_PATCH,
  '# 出厂 standard（0.2.0-rc.2 形状：只给 profile 平面用的组合片段）\n'
  + '- insert:\n'
  + '    - id: preset-standard\n'
  + "      name: '@deepseek-ai/dsh-agent-preset'\n"
  + '      config:\n'
  + '        id: standard\n'
  + '        order: 1\n'
  + '        plugins:\n'
  + '          - id: persona\n'
  + "            name: '@deepseek-ai/dsh-persona'\n"
  + '            config:\n'
  + '              suffix: Your working directory is {{cwd}}.\n'
  + '          - id: tool-pwsh\n'
  + "            name: '@deepseek-ai/dsh-tool-pwsh'\n"
  + '          - id: tool-fs\n'
  + "            name: '@deepseek-ai/dsh-tool-fs'\n", 'utf8')
const envBefore = process.env.DSH_AGENT_PRESETS_ROOT
process.env.DSH_AGENT_PRESETS_ROOT = srcRoot2
t('DP6 认出新形态的出厂预设（dsh-web-app/presets/<id>.patch.yml）',
  shippedPatchPreset(home3, 'standard') === SHIPPED_PATCH)
t('DP6b 新形态优先于老形态（旧残留不再被当成基座）', basePresetSource(home3, 'standard').kind === 'patch')
t('DP6c 越界 id 与不存在的 id 在 patch 探针上也被拒（与目录探针同一把锁）',
  shippedPatchPreset(home3, '../../evil') === '' && shippedPatchPreset(home3, 'no-such-preset') === '')

const home5 = mkdtempSync(path.join(os.tmpdir(), 'whale-persona-plane2-'))
const pdir5 = path.join(home5, 'profiles', 'desktop')
mkdirSync(pdir5, { recursive: true })
const PATCH5 = path.join(pdir5, 'cordis.patch.yml')
writeFileSync(PATCH5,
  '- id: some-tool\n'
  + '  name: "@deepseek-ai/dsh-some-tool"\n'
  + '- id: agent-preset-registry\n'
  + '  name: "@deepseek-ai/dsh-agent-preset-registry"\n'
  + '  config:\n'
  + '    default: standard\n', 'utf8')
process.argv = realArgv.concat([pdir5])
const ip6 = installPreset({ home: home5 })
const after6 = read(PATCH5)
t('DP6d 只有新形态基座时，profile 平面照样写出人设组合（action=created）', ip6.ok === true && ip6.action === 'created')
t('DP6e 人设行与工具行都从新形态基座搬来（10 格缩进 + tool-pwsh 一起来）',
  after6.indexOf('    - id: preset-' + PRESET_ID + '\n') > 0
  && after6.indexOf('          - id: ' + PRESET_ID + '\n') > 0
  && after6.indexOf("            name: '@deepseek-ai/dsh-tool-pwsh'") > 0)
t('DP6f 写完读数立刻就绪', presetState(home5).hasPersonaRow === true)
process.env.DSH_AGENT_PRESETS_ROOT = envBefore
process.argv = realArgv

// ── 桌面版身份：不把用户引到 .agent-presets（2026-10-16，issue #2 的另一半 / B 方案）────────────
// 触发来源：桌面版 0.2.0-rc.2 的出厂组合里没有 agent-preset-registry 段，判平面落到传统侧；
// 而桌面版根本不读 .agent-presets（0.1.7-rc.1 起 asar 全量 js 里就没有这个字样）——
// 本机实测更糟：那条路会返回 ok:true/dry **报成功**，用户以为建好了、人设却不生效。
// 这条钉的是"话说对"（不新增写入面、不改判平面）；"判据该不该换成宿主身份"是另一件要拍板的事（A 方案）。
const home6 = mkdtempSync(path.join(os.tmpdir(), 'whale-persona-desktop-'))
const envDesktopBefore = process.env.WHALE_PERSONA_DESKTOP_HOST
process.env.WHALE_PERSONA_DESKTOP_HOST = '1'
t('DP7 认得出桌面版宿主（判据可被夹具覆盖，与 DSH_AGENT_PRESETS_ROOT 同一手法）', isDesktopHost() === true)
const instDesktop = installPreset({ home: home6, dryRun: true })
t('DP7b 桌面版 + 传统平面 → 消息点名「不读 .agent-presets / 该走 profile 平面」',
  instDesktop.messages.some((m) => m.includes('这台宿主是桌面版') && m.includes('.agent-presets'))
  && instDesktop.messages.some((m) => m.includes('profile 平面')))
process.env.WHALE_PERSONA_DESKTOP_HOST = '0'
const instPlain = installPreset({ home: home6, dryRun: true })
t('DP7c 非桌面版（普通 Node / npm 安装）不出现这条警告',
  isDesktopHost() === false && instPlain.messages.every((m) => !m.includes('这台宿主是桌面版')))
if (envDesktopBefore === undefined) delete process.env.WHALE_PERSONA_DESKTOP_HOST
else process.env.WHALE_PERSONA_DESKTOP_HOST = envDesktopBefore

// ── 判平面改认宿主身份 + 缺 registry 段时补段（0.18.1，issue #3 / 2026-10-16 拍板）──────────
// 触发来源：桌面版 0.2.0-rc.2 的出厂组合里**没有** agent-preset-registry 段（本机实测出现 0 次），
// 旧判据（只看那一段在不在）会把桌面版判到传统平面 —— 用户点一下"报成功"、人设却不生效（issue #2/#3）。
// 新判据：桌面版身份 ⇒ profile 平面；缺的那一段由安装器在**同一次写盘**里补上
// （写前整份备份、写前写后各一次自检、任何一项不过就回滚）。
const envRoot8 = process.env.DSH_AGENT_PRESETS_ROOT
process.env.DSH_AGENT_PRESETS_ROOT = srcRoot2
const envD8 = process.env.WHALE_PERSONA_DESKTOP_HOST

const home7 = mkdtempSync(path.join(os.tmpdir(), 'whale-persona-plane3-'))
const pdir7 = path.join(home7, 'profiles', 'desktop')
mkdirSync(pdir7, { recursive: true })
const PATCH7 = path.join(pdir7, 'cordis.patch.yml')
writeFileSync(PATCH7,
  '# 桌面版 0.2.0-rc.2 出厂组合：没有 agent-preset-registry 段\n'
  + '- id: some-tool\n'
  + '  name: "@deepseek-ai/dsh-some-tool"\n', 'utf8')
process.argv = realArgv.concat([pdir7])
process.env.WHALE_PERSONA_DESKTOP_HOST = '1'
const plane7 = detectPresetPlane(home7)
t('DP8 桌面版 + 组合缺 registry 段 → 判成 profile 平面（不再被引去 .agent-presets）',
  plane7.plane === 'profile' && plane7.registryPresent === false && plane7.desktopHost === true)
const before7 = read(PATCH7)
const dry7 = installPreset({ home: home7, dryRun: true })
t('DP8b dry-run 就说清会补段，且一个字节都没写',
  dry7.messages.some((m) => m.includes('agent-preset-registry 段') && m.includes('selectedDefault'))
  && read(PATCH7) === before7)
const ip7 = installPreset({ home: home7 })
const after7 = read(PATCH7)
const p7 = parsePatchPresets(after7)
t('DP8c 补段 + 挂 preset 一次写完（纯追加 + action=created）',
  ip7.ok === true && ip7.action === 'created' && after7.indexOf(before7) === 0)
t('DP8d 补出的段形状照真机（- id 顶格 / name·config 2 格 / 键 4 格，值＝基座与人设预设）',
  /^- id: agent-preset-registry\n  name: "@deepseek-ai\/dsh-agent-preset-registry"\n  config:\n    default: standard\n    selectedDefault: whale-persona\n/m.test(after7)
  && p7.registryPresent === true)
t('DP8e 写完读数：人设在、且已算新任务默认',
  presetState(home7).hasPersonaRow === true && presetState(home7).isDefault === true)
t('DP8f 备份内容 === 写前（回滚点是真的）',
  readdirSync(pdir7).some((f) => f.startsWith('cordis.patch.yml.bak-') && read(path.join(pdir7, f)) === before7))
const ip7b = installPreset({ home: home7 })
t('DP8g 幂等复跑 kept：不追加第二段 registry、不追加第二个人设块',
  ip7b.action === 'kept' && read(PATCH7) === after7)

// 已有 registry 段的组合（本机两份真机组合都是这种）：不再多补一段
const home9 = mkdtempSync(path.join(os.tmpdir(), 'whale-persona-plane4-'))
const pdir9 = path.join(home9, 'profiles', 'desktop')
mkdirSync(pdir9, { recursive: true })
const PATCH9 = path.join(pdir9, 'cordis.patch.yml')
writeFileSync(PATCH9,
  '- id: agent-preset-registry\n'
  + '  name: "@deepseek-ai/dsh-agent-preset-registry"\n'
  + '  config:\n'
  + '    default: standard\n'
  + '    selectedDefault: whale\n', 'utf8')
process.argv = realArgv.concat([pdir9])
const before9 = read(PATCH9)
installPreset({ home: home9 })
const added9 = read(PATCH9).slice(before9.length)
t('DP8h 已有 registry 段时只挂 preset，不多补一段',
  (added9.match(/^- id: agent-preset-registry$/gm) || []).length === 0
  && parsePatchPresets(read(PATCH9)).presets.some((x) => x.hasPersonaRow))

// 非桌面版：同样的"缺段组合"仍按传统平面 —— 补段是桌面版身份下的行为，不外溢
const home8 = mkdtempSync(path.join(os.tmpdir(), 'whale-persona-plane5-'))
const pdir8 = path.join(home8, 'profiles', 'desktop')
mkdirSync(pdir8, { recursive: true })
const PATCH8 = path.join(pdir8, 'cordis.patch.yml')
writeFileSync(PATCH8, '- id: some-tool\n  name: "@deepseek-ai/dsh-some-tool"\n', 'utf8')
process.argv = realArgv.concat([pdir8])
process.env.WHALE_PERSONA_DESKTOP_HOST = '0'
t('DP8i 非桌面版 + 缺段组合 → 仍判传统平面，且一个字节没动',
  detectPresetPlane(home8).plane === 'agent-presets' && read(PATCH8).indexOf('agent-preset-registry') < 0)

if (envD8 === undefined) delete process.env.WHALE_PERSONA_DESKTOP_HOST
else process.env.WHALE_PERSONA_DESKTOP_HOST = envD8
if (envRoot8 === undefined) delete process.env.DSH_AGENT_PRESETS_ROOT
else process.env.DSH_AGENT_PRESETS_ROOT = envRoot8
process.argv = realArgv

console.log('---- preset-install 读数 ----')
console.log('home =', home)
console.log('presetId =', PRESET_ID, '· 显示名 =', PRESET_NAME, '· 目录 =', DIR)
