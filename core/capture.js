/**
 * 长期记忆「收口开关」（会话级，**文件后端**）。
 *
 * 为什么：把【入库纪律】（要我主动提议记忆候选的那一大段）**每轮注入**，会让不需要记忆的会话
 * 一直背着噪音，也多一块提示词注入面。改成按需——默认关，用户打开才注入。
 *
 * 怎么打开（三条路，读写同一份真源）：
 *   ① 宿主 UI 的开关控件（宿主自带的输入框 chip 就是调本模块的 isOnId/setOnId；第三方 UI 同样可调）；
 *   ② 会话内命令 /memory on|off|status（DSH 命令平面，零 token）；ZCode 版用消息里的 #记忆 前缀；
 *   ③ 配置 memory.capture='always' = 旧行为（每轮都注入，不经开关）。
 *
 * 存储：配置文件同目录的 session-flags.json —— { "<sessionId>": { "capture": true, "at": "ISO" } }
 * 为什么落文件（2026-09-18 改造）：① 重启后开关还在，不用重开一次；
 * ② **host 面两个插件共读一个真源**——设置面板/chip 显示的状态与 persona 段真实注入的状态
 * 不会脱钩（进程内存做不到这点）。带 mtime 缓存，读盘频次与 store.js 同量级。
 *
 * 作用域：只管「写」。【历史备忘】数据块与手工条目常驻（只受 memory.enabled 控制）。
 */
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { configPath } from './store.js'

/** 保留最近多少条会话开关（超出按 at 保新弃旧） */
const MAX_ENTRIES = 50

/** 开关存放文件：与配置文件同目录 */
export function flagFile() {
  try {
    return path.join(path.dirname(configPath()), 'session-flags.json')
  } catch {
    return ''
  }
}

let cache = { file: '', stamp: '', data: {} }
const byAgent = new WeakMap()
const scratch = { on: false }

function readFlags() {
  const f = flagFile()
  if (!f) return {}
  try {
    const st = statSync(f)
    const stamp = String(st.mtimeMs) + ':' + String(st.size)
    if (stamp !== cache.stamp || cache.file !== f) {
      const parsed = JSON.parse(readFileSync(f, 'utf8'))
      cache = { file: f, stamp, data: parsed && typeof parsed === 'object' ? parsed : {} }
    }
  } catch {
    if (cache.file !== f) cache = { file: f, stamp: '', data: {} }
  }
  return cache.data
}

function writeFlags(data) {
  const f = flagFile()
  if (!f) return
  try {
    mkdirSync(path.dirname(f), { recursive: true })
    const tmp = f + '.tmp'
    writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8')
    renameSync(tmp, f)
  } catch { /* 写不了：退化为进程内状态，功能不炸 */ }
  cache = { file: f, stamp: '', data }
}

function prune(data) {
  const keys = Object.keys(data)
  if (keys.length <= MAX_ENTRIES) return data
  const at = (k) => String((data[k] && data[k].at) || '')
  const drop = keys.sort((a, b) => at(a).localeCompare(at(b))).slice(0, keys.length - MAX_ENTRIES)
  for (const k of drop) delete data[k]
  return data
}

/** 按会话 id 读开关；id 为空返回 null（调用方退化为临时状态） */
export function isOnId(sessionId) {
  const id = typeof sessionId === 'string' ? sessionId.trim() : ''
  if (!id) return null
  const row = readFlags()[id]
  return !!(row && row.capture === true)
}

/** 按会话 id 写开关（on=false 时删掉该行，文件不无限长） */
export function setOnId(sessionId, on) {
  const id = typeof sessionId === 'string' ? sessionId.trim() : ''
  if (!id) return null
  const data = readFlags()
  if (on) data[id] = { capture: true, at: new Date().toISOString() }
  else delete data[id]
  writeFlags(prune(data))
  return !!on
}

/** 会话 id 从 agent 上取（DSH：agent.session.header.id；取不到则退化为 agent 对象身份） */
export function sessionIdOf(agent) {
  try {
    const id = agent && agent.session && agent.session.header && agent.session.header.id
    return typeof id === 'string' && id ? id : ''
  } catch {
    return ''
  }
}

/** 取该 agent 的临时状态对象（无会话 id 时用；任何异常都不抛） */
export function stateOf(agent) {
  try {
    if (agent && (typeof agent === 'object' || typeof agent === 'function')) {
      let s = byAgent.get(agent)
      if (!s) { s = { on: false }; byAgent.set(agent, s) }
      return s
    }
  } catch { /* 退化为临时状态 */ }
  return scratch
}

export function isOn(agent) {
  const fromFile = isOnId(sessionIdOf(agent))
  if (fromFile !== null) return fromFile
  return stateOf(agent).on === true
}

export function setOn(agent, on) {
  const written = setOnId(sessionIdOf(agent), on)
  if (written !== null) return written
  const s = stateOf(agent)
  s.on = !!on
  return s.on
}

/** 读配置里的收口模式：'always' = 旧行为（每轮注入）；其余（含缺省）= 'on-demand' */
export function captureMode(cfg) {
  const m = cfg && cfg.memory
  const raw = m && typeof m.capture === 'string' ? m.capture.trim().toLowerCase() : ''
  return raw === 'always' ? 'always' : 'on-demand'
}

/**
 * 本会话此刻是否该注入【入库纪律】。任一条件成立即不注入：
 * 插件总开关关 / memory.enabled 关 / memory.inbox 关 / 模式 on-demand 且会话开关没开。
 * 【历史备忘】数据块与手工条目都不受这里控制——它们是常驻的（只受 memory.enabled 控制）。
 */
export function captureActive(cfg, agent) {
  try {
    const m = cfg && cfg.memory
    if (!cfg || cfg.enabled === false || !m || m.enabled === false || m.inbox === false) return false
    if (captureMode(cfg) === 'always') return true
    return isOn(agent)
  } catch {
    return false
  }
}

const USAGE = '用法：/memory on | /memory off | /memory status'

/**
 * /memory [on|off|status] 的处理器实现：返回 UI 命令结果（{kind:'success'|'error', text}）。
 * 命令在 UI 命令平面执行，不产生模型消息、不占 token（dsh-commands 的约定）。
 * store 由调用方注入（测试可传假 store），此处只读配置、不改配置。
 */
export function runMemoryCommand(invocation, store) {
  try {
    const agent = invocation && invocation.agent
    const cfg = typeof store.get === 'function' ? store.get() : null
    const m = cfg && cfg.memory
    if (!cfg || cfg.enabled === false || !m || m.enabled === false || m.inbox === false) {
      return { kind: 'error', text: '长期记忆在配置里已关闭（enabled / memory.enabled / memory.inbox），会话开关打不开它。' }
    }
    const name = (cfg.persona && cfg.persona.userName) || '用户'
    if (captureMode(cfg) === 'always') {
      return { kind: 'success', text: '长期记忆收口：配置为 always —— 每轮都注入【入库纪律】，不需要会话开关。' }
    }
    const arg = String((invocation && invocation.rawInput) || '').trim().toLowerCase()
    if (arg === 'on' || arg === 'open') {
      setOn(agent, true)
      return { kind: 'success', text: '长期记忆收口：已为本会话打开（输入框左侧的「记忆」chip 也会亮）。下一轮起注入【入库纪律】，我会在阶段收口时给「## 记忆候选」，' + name + '确认后才写盘（【历史备忘】本来就是常驻的）。/memory off 关回去。' }
    }
    if (arg === 'off' || arg === 'close') {
      setOn(agent, false)
      return { kind: 'success', text: '长期记忆收口：已关。之后的轮次不再注入【入库纪律】（已确认的【历史备忘】照常加载，手工条目也不受影响）。' }
    }
    if (!arg || arg === 'status') {
      const where = isOn(agent) ? '已打开' : '已关闭'
      const chip = '（也可点输入框左侧的「记忆」chip 切换）'
      return { kind: 'success', text: '长期记忆收口：本会话' + where + chip + '\n' + USAGE }
    }
    return { kind: 'error', text: USAGE }
  } catch (e) {
    return { kind: 'error', text: '长期记忆开关执行失败：' + String((e && e.message) || e) }
  }
}
