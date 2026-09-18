/**
 * 「宿主实际用的模型 id」记录（0.9.0 补丁，2026-09-19 实测踩坑后加）
 *
 * 为什么需要：**界面上显示的模型名 ≠ 宿主传给插件的模型 id**。
 * 本机实测：DSH 对话框里写「DeepSeek-V4.1-Flash High」，而提示词段拿到的 `agent.options.model`
 * 是 `"deepseek-flash"` —— 于是用户照界面名往 byModel 里写关键词，永远命中不了。
 * 功能没坏，是键写错了，但用户无从知道该写什么。
 *
 * 做法：段求值时把**真实 id** 记进 <配置目录>/last-model.json（值没变就不重写盘，
 * 所以一轮会话只写一次）；设置面板读它并显示，新建「按模型」条目时直接预填它。
 * 只碰自己的配置目录、任何异常静默 —— 与全库「异常一律降级」同一口径。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { configPath } from './store.js'

const FILE = () => path.join(path.dirname(configPath()), 'last-model.json')

/**
 * 硬开关（2026-09-19 加，回应外部审查的那条提醒）：
 * 这个文件是纯本机元数据（只有 `{model, at}`，不联网、不含人设正文），
 * 但它在**配置目录**里 —— 谁把配置目录整体同步/备份，就会把本机模型 id 一起带走。
 * 介意的人设 `DSH_WHALE_LAST_MODEL=off` 即彻底不写（读也不写、不报错；面板那行提示自然消失）。
 * 不设 = 默认行为。任何取值异常都不影响人设渲染。
 */
const DISABLED = ['off', '0', 'false', 'no'].includes(String(process.env.DSH_WHALE_LAST_MODEL || '').trim().toLowerCase())

/** 进程内缓存：同一会话每一步都会求值一次段文本，不能每步都读盘 */
let cache = ''

export function recordModel(model) {
  try {
    if (DISABLED) return
    const id = typeof model === 'string' ? model.trim() : ''
    if (!id) return
    if (!cache) {
      try { cache = String(JSON.parse(readFileSync(FILE(), 'utf8')).model || '') } catch { cache = '' }
    }
    if (id === cache) return
    cache = id
    const file = FILE()
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ model: id, at: new Date().toISOString() }, null, 2) + '\n', 'utf8')
  } catch { /* 记不下来不影响人设 */ }
}

export function readLastModel() {
  try {
    const j = JSON.parse(readFileSync(FILE(), 'utf8'))
    return j && typeof j.model === 'string' ? j.model : ''
  } catch {
    return ''
  }
}
