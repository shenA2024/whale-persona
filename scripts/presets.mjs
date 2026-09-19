#!/usr/bin/env node
/**
 * 预设库命令行（0.10.0）——无头环境也能管人设预设。
 *
 *   node scripts/presets.mjs list                       # 列出预设（含目录）
 *   node scripts/presets.mjs show <id>                  # 打印预设 JSON
 *   node scripts/presets.mjs apply <id>                 # 应用到配置（现状自动存为 autosave）
 *   node scripts/presets.mjs save <id> [label]          # 把当前人设存成预设（可分享）
 *   node scripts/presets.mjs delete <id>
 *   node scripts/presets.mjs import <file.json>         # 自动认：酒馆卡 / 本引擎预设
 *   node scripts/presets.mjs export <id> [out.json] [--tavern]   # 默认导出本引擎格式；--tavern 导出酒馆 v2 卡
 *   node scripts/presets.mjs dir
 *
 * DSH_HOME 决定读哪一份（默认 ~/.dsh）；config 定位同 core/store.js。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  PRESET_SPEC, applyPresetToFile, deletePreset, listPresets, loadPreset,
  presetsDir, presetFromConfig, safeId, savePreset,
} from '../core/presetStore.js'
import { detectCard, fromTavern, toTavern } from '../core/tavernCard.js'
import { configPath, createStore } from '../core/store.js'

const argv = process.argv.slice(2)
const cmd = (argv[0] || 'list').toLowerCase()
const rest = argv.slice(1).filter((a) => a !== '--tavern')
const taverner = argv.includes('--tavern')

function die(msg) {
  console.error(msg)
  process.exit(1)
}

if (cmd === 'dir') {
  console.log(presetsDir().replace(/\\/g, '/'))
} else if (cmd === 'list') {
  const rows = listPresets()
  console.log('预设目录：' + presetsDir().replace(/\\/g, '/'))
  console.log('配置文件：' + configPath().replace(/\\/g, '/'))
  if (!rows.length) console.log('(空)')
  for (const r of rows) {
    console.log('- ' + r.id + '  ' + r.label
      + (r.contracts ? '  契约 ' + r.contracts + ' 条' : '')
      + (r.hasCharacter ? '  有正文' : '')
      + (r.hasTone ? '  有语气' : '')
      + (r.hasAppearance ? '  有形象' : '')
      + (r.author ? '  作者 ' + r.author : ''))
  }
} else if (cmd === 'show') {
  const p = loadPreset(rest[0])
  if (!p) die('找不到预设：' + rest[0])
  console.log(JSON.stringify(p, null, 2))
} else if (cmd === 'apply') {
  const p = loadPreset(rest[0])
  if (!p) die('找不到预设：' + rest[0])
  const r = applyPresetToFile(p)
  if (!r.ok) die('应用失败：' + r.error)
  console.log('已应用 ' + p.id + ' —— 配置下一步生效' + (r.autosave ? '；现状已存为 autosave（上次的人设）' : ''))
} else if (cmd === 'save') {
  const id = safeId(rest[0])
  if (!id) die('id 只能字母数字_-：' + rest[0])
  const cfg = createStore().get()
  const p = presetFromConfig(cfg, { id, label: rest[1] || id, description: '' })
  const f = savePreset(p)
  if (!f) die('保存失败')
  console.log('已存为预设 ' + id + ' → ' + f.replace(/\\/g, '/'))
} else if (cmd === 'delete') {
  console.log(deletePreset(rest[0]) ? '已删除 ' + rest[0] : '没有这个预设：' + rest[0])
} else if (cmd === 'import') {
  const file = rest[0]
  if (!file) die('用法：import <file.json>')
  let raw
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    die('读不了 / 不是合法 JSON：' + e.message + '（酒馆的 PNG 卡请先在酒馆里导出成 JSON）')
  }
  const kind = detectCard(raw)
  let preset = null
  if (kind === 'tavern-v2' || kind === 'tavern-v1') {
    const imp = fromTavern(raw)
    if (!imp) die('这张卡读不出来')
    preset = imp.preset
    console.log('认作：酒馆角色卡（' + kind + '）')
    if (imp.mapped.length) console.log('已映射：' + imp.mapped.join(' / '))
    if (imp.unmapped.length) console.log('不承接：' + imp.unmapped.join(' / '))
    for (const n of imp.notes) console.log('注意：' + n)
  } else if (kind === 'whale-preset') {
    preset = { id: raw.id || path.basename(file, '.json'), label: raw.label || raw.id || path.basename(file, '.json'), persona: raw.persona || {}, thinkingLanguage: raw.thinkingLanguage }
    if (!preset.persona || !Object.keys(preset.persona).length) {
      preset.persona = { character: typeof raw.character === 'string' ? raw.character : '', contracts: Array.isArray(raw.contracts) ? raw.contracts : [] }
    }
    console.log('认作：whale-persona 预设（' + (raw.spec || '早期格式') + '）')
  } else {
    die('认不出这是哪种卡（既不是酒馆 v1/v2 角色卡，也不是本引擎预设）')
  }
  let id = safeId(preset.id)
  if (!id) { preset.id = 'imported'; id = 'imported' }
  let n = 1
  while (loadPreset(id)) { n += 1; id = safeId(preset.id + '-' + n) || preset.id + '-' + n }
  preset.id = id
  const f = savePreset(preset)
  if (!f) die('写入失败')
  console.log('已导入为预设 ' + id + ' → ' + f.replace(/\\/g, '/'))
  console.log('（未自动应用；确认内容后 node scripts/presets.mjs apply ' + id + '）')
} else if (cmd === 'export') {
  const p = loadPreset(rest[0])
  if (!p) die('找不到预设：' + rest[0])
  const body = taverner ? toTavern(p) : { spec: PRESET_SPEC, id: p.id, label: p.label, description: p.description, author: p.author, tags: p.tags, thinkingLanguage: p.thinkingLanguage, persona: p.persona }
  const out = rest[1]
  if (!out) {
    console.log(JSON.stringify(body, null, 2))
  } else {
    writeFileSync(out, JSON.stringify(body, null, 2) + '\n', 'utf8')
    console.log('已导出 → ' + out + (taverner ? '（酒馆 v2 卡）' : '（本引擎预设）'))
  }
} else {
  die('未知命令：' + cmd + '（list/show/apply/save/delete/import/export/dir）')
}
