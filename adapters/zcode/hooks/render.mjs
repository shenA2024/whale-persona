#!/usr/bin/env node
/**
 * whale-persona · ZCode hook 脚本：UserPromptSubmit → additionalContext
 *
 * 每次用户提交输入时运行：读共享 config → core 渲染 → 把人设/契约/记忆备忘作为
 * additionalContext 注入对话。效果对齐 DSH 适配器的 persona 段：改配置下一步生效。
 *
 * 调用方式：
 *   hook 模式（ZCode 自动）：stdin 收事件 JSON {prompt, cwd, session_id, ...}，字段缺了也能跑
 *   预览模式（人工/skill 用）：node render.mjs --preview —— 不读 stdin，直接打印渲染全文
 *
 * 纪律（与 DSH 版一致）：任何异常输出空并 exit 0 —— hook 永远不让会话炸。
 */
import { readFileSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mergeConfig } from '../vendor/core/defaults.js'
import { tierOf } from '../vendor/core/render.js'
import { buildPersonaPrompt, buildSuffix, buildThinkingLanguage } from '../vendor/core/prompt.js'

/**
 * config 定位链（优先级从高到低）：
 *   ① WHALE_PERSONA_CONFIG（ZCode 用户显式指定）
 *   ② DSH_WHALE_CONFIG（DSH 用户显式指定 —— 双宿主共用一份配置）
 *   ③ $DSH_HOME/whale-suite/config.json（DSH 默认位置，存在即用 —— 一份人设两个宿主）
 *   ④ ~/.whale-persona/config.json（纯 ZCode 用户的默认位置）
 *   ⑤ 都没有：纯默认值（渲染为空 = 装上不改行为）
 */
function locateConfig() {
  const cands = []
  if (process.env.WHALE_PERSONA_CONFIG) cands.push(process.env.WHALE_PERSONA_CONFIG)
  if (process.env.DSH_WHALE_CONFIG) cands.push(process.env.DSH_WHALE_CONFIG)
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  cands.push(path.join(dshHome, 'whale-suite', 'config.json'))
  cands.push(path.join(os.homedir(), '.whale-persona', 'config.json'))
  for (const f of cands) {
    try { if (existsSync(f)) return f } catch { /* 读不了就跳过 */ }
  }
  return null
}

function readConfig() {
  const f = locateConfig()
  if (!f) return mergeConfig(null)
  try {
    return mergeConfig(JSON.parse(readFileSync(f, 'utf8')))
  } catch {
    return mergeConfig(null) // 坏 JSON 回落默认（症状：人设消失，不炸）
  }
}

function render(cfg, input) {
  const model = input && typeof input.model === 'string' ? input.model : null
  const cwd = input && typeof input.cwd === 'string' ? input.cwd : ''
  const parts = [
    buildPersonaPrompt(cfg, model, cwd),
    buildThinkingLanguage(cfg),
    buildSuffix(cfg, cwd),
  ].filter(Boolean)
  return parts.join('\n\n')
}

function emit(context) {
  // 空 context 时输出空（空输出合法，不注入任何东西）
  if (!context) return
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: context,
    },
  }))
}

const isPreview = process.argv.includes('--preview')
if (isPreview) {
  // 预览/静态模式：打印渲染全文（skill 用来给人看、或贴进 AGENTS.md 做无 hook 兜底）
  const out = render(readConfig(), { cwd: process.cwd() })
  if (out) console.log(out)
  process.exit(0)
}

// hook 模式：收 stdin 事件 JSON
let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => { raw += c })
process.stdin.on('end', () => {
  try {
    const input = raw.trim() ? JSON.parse(raw) : {}
    emit(render(readConfig(), input))
  } catch {
    emit('') // 解析失败也安静退出
  }
  process.exit(0)
})
process.stdin.on('error', () => process.exit(0))
