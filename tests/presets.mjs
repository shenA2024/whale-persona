// 预设库冒烟（0.10.0）：种子 / 存取 / 越界 id / 只覆盖出现的字段 / 老格式兼容 / 不带记忆
// 断言强制：false 即非零退出（跑器只认非零退出/FAIL 字样）。
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const home = mkdtempSync(path.join(os.tmpdir(), 'whale-persona-presets-'))
process.env.DSH_HOME = home
delete process.env.DSH_WHALE_CONFIG

const t = (name, ok) => {
  console.log(name + ':', ok)
  if (!ok) process.exitCode = 1
}

const P = await import('../core/presetStore.js')
const { readRawConfig, writeMergedConfig } = await import('../core/edit.js')

// ── 种子 ────────────────────────────────────────────────────────────────
const list0 = P.listPresets()
t('P1 种子已播种(blank+starter):', list0.some((x) => x.id === 'blank') && list0.some((x) => x.id === 'starter'))
t('P1 目录落在 whale-persona/presets:', P.presetsDir().replace(/\\/g, '/').includes('/whale-persona/presets'))

// 改种子文件后再播种，不许覆盖
const starterFile = P.presetFile('starter')
const edited = JSON.parse(readFileSync(starterFile, 'utf8'))
edited.label = '我改过的起步集'
writeFileSync(starterFile, JSON.stringify(edited, null, 2), 'utf8')
P.ensureSeeds()
t('P2 播种不覆盖用户改过的:', P.loadPreset('starter').label === '我改过的起步集')

// ── id 安全 ─────────────────────────────────────────────────────────────
t('P3 挡路径穿越:', P.safeId('../evil') === null && P.safeId('a/b') === null && P.safeId('') === null && P.safeId('a b') === null)
t('P3 正常 id 放行:', P.safeId('my-persona_2') === 'my-persona_2')
t('P3 越界 id 读写都拒:', P.presetFile('../evil') === '' && P.loadPreset('../evil') === null)

// ── 存取往返 ────────────────────────────────────────────────────────────
const saved = P.savePreset({
  id: 'roundtrip', label: '往返卡', description: '测试用',
  author: 'tester', tags: ['a', 'b'],
  thinkingLanguage: 'zh-CN',
  persona: { userName: '小林', selfNameFlash: '小助手', character: '你是{selfName}。', contracts: [{ id: 'k1', text: '先给结论。', on: true }], tone: { enabled: true, text: '干脆', byModel: {} } },
})
t('P4 保存返回路径:', typeof saved === 'string' && saved.endsWith('roundtrip.json'))
const back = P.loadPreset('roundtrip')
t('P4 往返字段齐:', back.label === '往返卡' && back.author === 'tester' && back.tags.length === 2 && back.thinkingLanguage === 'zh-CN')
t('P4 往返 persona 齐:', back.persona.userName === '小林' && back.persona.contracts.length === 1 && back.persona.tone.text === '干脆')
t('P4 写出的文件带 spec:', JSON.parse(readFileSync(saved, 'utf8')).spec === P.PRESET_SPEC)

// ── 应用：只覆盖预设里出现的字段 ─────────────────────────────────────────
const cfg = {
  enabled: true, thinkingLanguage: 'en',
  persona: { enabled: true, userName: '小林', selfNameFlash: '小助手', character: '旧正文', legacyField: '保我' },
  context: { memory: true }, forge: { enabled: true },
}
const legacyPreset = P.normalizePreset({ id: 'old', label: '老格式', character: '新正文', contracts: [{ id: 'x', text: '新契约', on: true }] }, 'old')
const next = P.applyPresetToConfig(cfg, legacyPreset)
t('P5 老格式(顶层 character/contracts)能认:', !!legacyPreset && legacyPreset.persona.character === '新正文')
t('P5 覆盖预设里出现的:', next.persona.character === '新正文' && next.persona.contracts.length === 1)
t('P5 没出现的字段保持原样:', next.persona.userName === '小林' && next.persona.selfNameFlash === '小助手')
t('P5 persona 未知子键不丢:', next.persona.legacyField === '保我')
t('P5 别的段不丢:', next.context.memory === true && next.forge.enabled === true && next.enabled === true)

// ── 预设不带记忆 ────────────────────────────────────────────────────────
const fromCfg = P.presetFromConfig({ thinkingLanguage: 'zh-CN', persona: { userName: '小林', character: 'x' }, memory: { enabled: true, entries: [{ text: '示例条目', on: true }] } }, { id: 'snap', label: '快照' })
t('P9 快照不含 memory:', !Object.prototype.hasOwnProperty.call(fromCfg, 'memory') && !Object.prototype.hasOwnProperty.call(fromCfg.persona, 'entries'))

// ── 坏文件 & 落盘纪律 ───────────────────────────────────────────────────
writeFileSync(path.join(P.presetsDir(), 'broken.json'), '{ this is not json', 'utf8')
t('P7 坏文件跳过不牵连:', P.listPresets().some((x) => x.id === 'starter') && !P.listPresets().some((x) => x.id === 'broken'))

// ── 经由 edit.js 落盘：未知键保留 + 坏 JSON 拒写 ─────────────────────────
process.env.DSH_WHALE_CONFIG = path.join(home, 'config.json')
// 注意 writeMergedConfig 的语义：**只写已知段**（enabled/thinkingLanguage/persona/memory），
// 别的段是"原样保留"——保留的是**磁盘上已有的**那些，patch 里塞未知段会被丢掉。
// 所以要验"别的段不丢"，得先让磁盘上真有那个段（这里直接写文件造出来）。
writeFileSync(process.env.DSH_WHALE_CONFIG, JSON.stringify({
  enabled: true, thinkingLanguage: 'en', persona: { userName: '小林', character: '旧' },
  context: { memory: true }, forge: { enabled: true },
}, null, 2), 'utf8')
writeMergedConfig(P.applyPresetToConfig(readRawConfig(), P.loadPreset('starter')))
const onDisk = readRawConfig()
t('P6 落盘后别的段还在:', onDisk.context.memory === true && onDisk.forge.enabled === true)
t('P6 落盘后契约已应用:', Array.isArray(onDisk.persona.contracts) && onDisk.persona.contracts.length === 5)
writeFileSync(process.env.DSH_WHALE_CONFIG, '{ bad', 'utf8')
let threw = false
try { writeMergedConfig({ enabled: true }) } catch { threw = true }
t('P6 坏 JSON 拒写:', threw)

// ── 删除 ────────────────────────────────────────────────────────────────
t('P8 删除生效:', P.deletePreset('roundtrip') === true && P.loadPreset('roundtrip') === null && P.deletePreset('roundtrip') === false)
