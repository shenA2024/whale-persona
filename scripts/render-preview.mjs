#!/usr/bin/env node
/**
 * 渲染预览 —— 把 config.json 渲染成插件**实际注入**的那几段文本，直接打印出来。
 *
 * 为什么需要它：本仓不含图形设置界面。用户改完配置想知道"到底往系统提示词里塞了什么"，
 * 就用这个（等价于设置面板里的预览窗）。它读的是同一套 core/，所以输出与运行期逐字一致。
 *
 * 用法：
 *   node scripts/render-preview.mjs                                   # 读默认定位链上的 config.json
 *   node scripts/render-preview.mjs --config examples/demo-config.json --capture
 *   node scripts/render-preview.mjs --model pro --cwd D:/work/demo
 *
 * 参数：
 *   --config <path>  指定配置文件（默认走定位链：$WHALE_PERSONA_CONFIG → $DSH_WHALE_CONFIG →
 *                    $DSH_HOME/whale-persona/config.json，旧布局 whale-suite 自动沿用）
 *   --model <name>   模型名（含 "pro" 用 selfNamePro，否则 selfNameFlash；默认 flash）
 *   --cwd <path>     工作目录（供 {{cwd}} 与记忆 tag 相关性选择用；默认当前目录）
 *   --capture        强制按"已打开收口开关"渲染（看【入库纪律】长什么样）
 */
import { existsSync, readFileSync } from 'node:fs'
import { mergeConfig } from '../core/defaults.js'
import { buildPersonaPrompt, buildSuffix, buildThinkingLanguage } from '../core/prompt.js'
import { captureMode } from '../core/capture.js'
import { configPath } from '../core/store.js'

function argOf(name, fallback) {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const wantConfig = argOf('--config', '')
const model = argOf('--model', 'flash')
const cwd = argOf('--cwd', process.cwd())
const forceCapture = process.argv.includes('--capture')

const file = wantConfig || configPath()
if (!existsSync(file)) {
  console.error('找不到配置文件：' + file)
  console.error('（先按 README 的「配置」一节写一份，或用 --config 指定）')
  process.exit(2)
}
let cfg
try {
  cfg = mergeConfig(JSON.parse(readFileSync(file, 'utf8')))
} catch (e) {
  console.error('配置不是合法 JSON：' + String((e && e.message) || e))
  process.exit(2)
}

const mode = captureMode(cfg)
const capture = forceCapture || mode === 'always'
const block = (title, text) => {
  console.log('')
  console.log('=== ' + title + ' ===')
  console.log(text ? text : '(空 —— 该段不会出现在系统提示词里)')
}

block('deployment:persona-prefix', buildPersonaPrompt(cfg, model, cwd, { capture }))
block('whale:thinking-language', buildThinkingLanguage(cfg))
block('deployment:persona-suffix', buildSuffix(cfg, cwd))

console.log('')
console.log('--- 概要 ---')
console.log('配置：' + file.replace(/\\/g, '/'))
console.log('模型档：' + (String(model).toLowerCase().includes('pro') ? 'pro → selfNamePro' : 'flash → selfNameFlash'))
console.log('收口开关：' + (mode === 'always' ? "配置 capture='always'（每轮注入）" : (capture ? '本次按已打开渲染（--capture）' : '默认关 —— 加 --capture 可以看到打开后的样子')))
console.log('记忆：【历史备忘】与手工条目常驻；【入库纪律】受上面这个开关控制。')
