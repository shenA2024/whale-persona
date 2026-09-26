/**
 * 长期记忆收件箱（2026-09-18 建；同日升级为事件溯源式合并 + tag 相关性选择）。
 *
 * 设计要点（对照 claude-mem/mem0 的自动捕获 + 我们的「用户拍板」哲学）：
 *   ① 只追加：入库动作永远是**追加一行 JSON**，永不改写已有行——
 *      坏一行不影响其他行，损坏面为零；
 *   ② 确认流：候选在对话里列出、用户拍板后才入库，AI 不替用户决定记什么；
 *   ③ 合并语义（mem0 式 ADD/UPDATE/DELETE，闸门仍是用户确认）：
 *      事实行 {"text","at","tag"?}；操作行 {"op":"supersede","ref":"旧原文","text":"新原文","at","tag"?}
 *      替换第一条原文命中条目（视为新近，移到队尾）；{"op":"drop","ref":"旧原文","at"} 把它移出视图。
 *      读取时按行序**重放**出注入视图——物理只追加，逻辑可更新可删去；
 *      ref 命不中的操作行自然空转（不损坏任何数据）。
 *   ④ 注入上限（相关性优先）：当前项目 tag 命中 > 全局（无 tag）> 其他项目；
 *      同组超出上限保新弃旧。
 *   ⑤ 确认闸门（0.8.0，**代码强制**，不再只是提示词约束）：
 *      事实行可带 status —— 'proposed'（候选，AI 写的）/ 'confirmed'（人工确认过）/ 缺省（老格式 legacy）。
 *      注入视图只收 confirmed（老用户可把 memory.requireConfirm 关掉，放行 legacy）；
 *      proposed **永不注入**——AI 写进去也只是一条待确认候选。
 *      让候选生效的唯一动作是人工追加一行操作行：{"op":"confirm","ref":"原文","at":...}
 *      （scripts/memory.mjs confirm / 设置面板按钮）。AI 没有被授予这个动作。
 * ⑥ 类别（0.13.0）：事实行可带 kind —— 缺省 'memory' 为注入型；其余 kind 为**沉降型**，
 *   确认后由 core/sinks.js 按 memory.sinks 路由落盘，且永不注入（readInjected 只收 memory 类）。
 * ⑦ 层级（0.17.0，触发来源：用户提出「记忆按常用度分级 + 索引 + 按需读」）：
 *   事实行可带 tier —— 显式 'core'（**免限常驻**，不参与上限竞争）/ 'hot'（与老条目一样按相关性参与，
 *   超额时正文不展开）/ 'cold'（从不展开正文，只出现在【记忆目录】里，需要时按序号读全文）；
 *   **未指定 tier 的老条目照旧**（= 与 hot 同一路径，pickRelevant 决定去留）——所以装上零行为改变。
 *   判据不是「常用度」而是**缺席成本**：安全边界、终局契约、指针类记忆（去哪查）一旦缺席代价不可逆，
 *   该标 core；频率低不等于可以降级。改层级只走人工：{"op":"retier","ref":"原文","tier":"cold"}。
 *   splitByTier() 负责分层选择，cold 与超额条目交给 prompt.js 渲染成目录（一行一条、只给摘要+序号），
 *   顺带补掉了「超出上限静默消失」那个老毛病——被挤出的条目现在至少出现在目录里。
 * 条目文本在读取时折叠换行——防止带 \n 的条目从「数据」列表项里伪造成新指令行。
 * 读法带 mtime 缓存（与 store 同款纪律），任何异常返回空数组。
 *
 * 同源纪律：本仓库 core/ 是唯一源；adapters/zcode/vendor/core/ 的副本由
 * scripts/sync-core.mjs 刷新，勿手改（tests/zcode-hook.mjs 的 Z7 会校验两份一致）。
 */
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { configDir } from './store.js'

/** 收件箱默认落点：与配置同目录（见 store.js 的 configDir()） */
export function inboxFile() {
  return path.join(configDir(), 'memory-inbox.jsonl')
}

/** 解析收件箱路径：config.memory.inboxPath 优先，为空则用 inboxFile() 的默认落点 */
export function resolveInbox(cfgPath) {
  const p = String(cfgPath || '').trim()
  return p ? p : inboxFile()
}

const cache = { file: '', key: '', entries: [] }

const fold = (s) => (s === undefined || s === null ? '' : String(s).trim().replace(/[\r\n]+/g, ' '))

/**
 * 条目状态。proposed = AI 写的候选（永不注入）；confirmed = 人工确认过（注入）；
 * legacy = 老格式没有 status 字段（默认不注入，用户可显式放行）。
 */
export const STATUS = { proposed: 'proposed', confirmed: 'confirmed', legacy: 'legacy' }

/**
 * 条目类别（0.13.0）。缺省 = 'memory'：它是**注入型**，确认后进【历史备忘】。
 * 其余 kind（pitfall / idea / placement …）是**沉降型**：确认后按 memory.sinks 路由只追加式落盘，
 * 永不注入提示词（见 core/sinks.js）。没有 kind 字段的老行一律当 'memory' —— 老行为逐字节不变。
 */
export const MEMORY_KIND = 'memory'

/**
 * 条目层级（0.17.0），可省字段，**未指定 ≠ core**（未指定走老路径，见下）：
 *   · 'core' = 免限常驻：永远展开正文，**不占** maxEntries 的额度（额度只管竞争池）；
 *   · 'hot'  = 与未指定同路径：一起按相关性竞争 maxEntries 额度；
 *   · 'cold' = 从不展开正文，只进【记忆目录】（可按序号读全文）。
 * 只有显式 core 才免限——所以没有标过 tier 的老配置，行为与 0.16.x 逐字节一致。
 */
export const TIER = { core: 'core', hot: 'hot', cold: 'cold' }

/** kind 归一化：小写、只留 [a-z0-9_-]（防花样 kind 变成路径花样）；空 = 未指定 */
export function normKind(v) {
  return String(v == null ? '' : v).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
}

/** 条目的有效 kind（未指定 → memory） */
export function kindOf(entry) {
  const k = normKind(entry && entry.kind)
  return k || MEMORY_KIND
}

/** tier 归一化：只认 core/hot/cold；空串 = **未指定**（老行不兜底成 core，由调用方按老路径处理） */
export function normTier(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase()
  return s === TIER.hot || s === TIER.cold || s === TIER.core ? s : ''
}

/** 条目的有效层级（未指定 → core：老条目行为逐字节不变） */
export function memTierOf(entry) {
  return normTier(entry && entry.tier) || TIER.core
}

/** status 解析：只认 'confirmed'；'proposed' 与一切未知值都算未确认（宁可不注入，不可误注入） */
function statusOf(raw) {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (s === 'confirmed') return STATUS.confirmed
  if (s === 'proposed') return STATUS.proposed
  return STATUS.legacy
}

/** 把一行 JSON 解析为事实/操作/坏行（null）。所有文本换行一律折叠成空格（防伪指令行）。 */
function parseLine(line) {
  const s = line.trim()
  if (!s) return null
  try {
    const o = JSON.parse(s)
    if (!o || typeof o !== 'object') return null
    const op = typeof o.op === 'string' ? o.op : ''
    if (op === 'supersede') {
      const ref = fold(o.ref)
      const text = fold(o.text)
      if (!ref || !text) return null
      return { op, ref, text, at: typeof o.at === 'string' ? o.at : '', tag: fold(o.tag), status: statusOf(o.status), kind: normKind(o.kind), tier: normTier(o.tier) }
    }
    if (op === 'drop' || op === 'reject' || op === 'confirm') {
      const ref = fold(o.ref)
      if (!ref) return null
      return { op, ref, at: typeof o.at === 'string' ? o.at : '' }
    }
    if (op === 'retier') {
      const ref = fold(o.ref)
      const tier = normTier(o.tier)
      if (!ref || !tier) return null // 没有有效 tier 的 retier 是空操作，直接跳过
      return { op, ref, tier, at: typeof o.at === 'string' ? o.at : '' }
    }
    if (op) return null // 未知 op：只跳过该行，不牵连整箱
    const text = fold(o.text)
    if (!text) return null
    return { op: '', text, at: typeof o.at === 'string' ? o.at : '', tag: fold(o.tag), status: statusOf(o.status), kind: normKind(o.kind), tier: normTier(o.tier) }
  } catch {
    return null // 坏行跳过，不牵连整箱
  }
}

/** 重放：按行序把操作行应用到事实行上，得到注入视图 [{text, at, tag}]（时间序旧→新）。 */
export function replayInbox(lines) {
  const entries = []
  for (const line of lines) {
    const o = parseLine(line)
    if (!o) continue
    if (!o.op) {
      // tier 未写 = 空串（**不要**在这里兜 core：兜了就全变免限常驻，老配置的上限会失效）
      entries.push({ text: o.text, at: o.at, tag: o.tag, status: o.status, kind: o.kind || MEMORY_KIND, tier: o.tier || '' })
      continue
    }
    const i = entries.findIndex((e) => e.text === o.ref)
    if (i < 0) continue
    if (o.op === 'drop' || o.op === 'reject') {
      entries.splice(i, 1) // 删去：人工否决/回收，物理行仍在文件里
    } else if (o.op === 'confirm') {
      entries[i] = { ...entries[i], status: STATUS.confirmed } // 人工确认：候选转正
    } else if (o.op === 'retier') {
      entries[i] = { ...entries[i], tier: o.tier } // 人工改层级：只动 tier，其他字段原样
    } else {
      const old = entries[i]
      entries.splice(i, 1)
      // 替换后视为新近，移到队尾；没写明 status 的 supersede 沿用旧条目的确认状态（人工改写不丢确认）
      entries.push({
        text: o.text, at: o.at, tag: o.tag || old.tag || '',
        status: o.status === STATUS.legacy ? old.status : o.status,
        // 没写 kind 的 supersede 沿用旧条目的 kind（人工改写不该把沉降条目变成注入条目，反之亦然）
        kind: o.kind || old.kind || MEMORY_KIND,
        // 没写 tier 的 supersede 沿用旧层级（未指定仍是未指定，不会因为改写就变免限常驻）
        tier: o.tier || old.tier || '',
      })
    }
  }
  return entries
}

/** 读收件箱（带 mtime 缓存）。坏行跳过；返回重放后的视图 [{text, at, tag}]（时间序旧→新） */
export function readInbox(file) {
  const f = file || inboxFile()
  try {
    const st = statSync(f)
    const key = String(st.mtimeMs) + ':' + String(st.size)
    if (key !== cache.key || cache.file !== f) {
      cache.file = f
      cache.key = key
      cache.entries = replayInbox(readFileSync(f, 'utf8').split(/\r?\n/))
    }
    return cache.entries
  } catch {
    return []
  }
}

/**
 * 注入上限下的相关性选择：当前项目 tag 命中（2）> 全局无 tag（1）> 其他项目（0）；
 * 高分组整组保留、低分组超出上限保新弃旧；返回恢复时间序（旧→新）。
 * tag 匹配用**路径段**精确比较（防『app』『src』这类短名子串放水到所有目录）。
 */
export function pickRelevant(entries, max, cwd) {
  const n = Number(max) > 0 ? Number(max) : 30
  if (entries.length <= n) return entries
  const base = String(cwd || '').replace(/\\/g, '/').toLowerCase()
  const segs = base ? base.split('/').filter(Boolean) : []
  const proj = segs.length ? segs[segs.length - 1] : ''
  const score = (e) => {
    const tag = String(e.tag || '').trim().toLowerCase()
    if (!tag) return 1
    if (proj && (tag === proj || segs.includes(tag))) return 2
    return 0
  }
  return entries
    .map((e, i) => ({ e, i, s: score(e) }))
    .sort((a, b) => (b.s - a.s) || (b.i - a.i)) // 分数降序；同分组新的在前
    .slice(0, n)
    .sort((a, b) => a.i - b.i) // 恢复时间序，注入可读
    .map((r) => r.e)
}

/**
 * 分层选择（0.17.0）：把注入视图劈成「本轮展开正文」与「只进目录」两半。
 *   · 显式 tier:"core" → **免限常驻**（人工标的「永远在场」，不参与上限竞争）；
 *   · 未指定 tier（老条目）与 tier:"hot" → 一起走 pickRelevant，额度 = max（**core 不占额度**，
 *     所以没有显式 core 时这就是老行为：pickRelevant(全部, max)，逐字节一致）；
 *   · tier:"cold" → 一律不展开正文，只进目录。
 * 返回 { inject: [条目...], index: [{seq, entry, why}...] } —— seq 是**重放视图序号**
 * （与 memory.mjs status 一致），why ∈ 'cold' | 'over'（超出额度未展开）；两半都保持时间序（旧→新）。
 */
export function splitByTier(entries, max, cwd) {
  const list = Array.isArray(entries) ? entries : []
  const seqOf = new Map(list.map((e, i) => [e, i]))
  const pinned = []
  const contend = []
  const cold = []
  for (const e of list) {
    const t = normTier(e && e.tier)
    if (t === TIER.cold) cold.push(e)
    else if (t === TIER.core) pinned.push(e)
    else contend.push(e)
  }
  const n = Number(max) > 0 ? Number(max) : 30
  // maxEntries 只约束**竞争池**：core 是人工标定的免限常驻，不吃这个额度
  // （2026-09-25 修正：原先写成 n - pinned.length，core 反而挤掉了竞争池的名额，
  //   实测把 [1] GitHub 代理、[2] 称呼两条挤出正文——与「免限」口径不符。）
  const room = Math.max(0, n)
  const picked = room > 0 ? pickRelevant(contend, room, cwd) : []
  const pickedSet = new Set(picked)
  const byTime = (a, b) => (seqOf.get(a) || 0) - (seqOf.get(b) || 0)
  return {
    inject: pinned.concat(picked).sort(byTime),
    index: contend
      .filter((e) => !pickedSet.has(e))
      .map((e) => ({ seq: seqOf.get(e) || 0, entry: e, why: 'over' }))
      .concat(cold.map((e) => ({ seq: seqOf.get(e) || 0, entry: e, why: TIER.cold })))
      .sort((a, b) => a.seq - b.seq),
  }
}

/**
 * 目录行：未注入条目的**一行索引**（序号 + 层级 + 摘要），供【记忆目录】块渲染。
 * 摘要是给人（AI）做「要不要去读」判断用的，不是全文——所以截断，别把整条搬进提示词。
 */
export function indexBrief(entry, limit) {
  const text = String((entry && entry.text) || '').replace(/[\r\n]+/g, ' ')
  const n = Number(limit) > 0 ? Number(limit) : 44
  return text.length > n ? text.slice(0, n) + '…' : text
}

/** 关键词检索（大小写不敏感，匹配正文与 tag）：返回 [{seq, entry}]，供 CLI search 用 */
export function findEntries(entries, query) {
  const q = String(query == null ? '' : query).trim().toLowerCase()
  if (!q) return []
  const out = []
  ;(Array.isArray(entries) ? entries : []).forEach((e, i) => {
    const hay = (String(e.text || '') + ' ' + String(e.tag || '')).toLowerCase()
    if (hay.includes(q)) out.push({ seq: i, entry: e })
  })
  return out
}

/**
 * 注入视图：默认只收人工确认过的条目。
 *   · confirmed 一定注入；
 *   · legacy（老格式）只在 opts.allowLegacy 时注入 —— 对应配置 memory.requireConfirm:false；
 *   · proposed 永不注入（AI 只能提议，生效必须人工确认）。
 */
export function readInjected(file, opts) {
  const allowLegacy = !!(opts && opts.allowLegacy)
  // 只注入 memory 类：沉降类条目（kind 非 memory）即使已确认也不进提示词 —— 它们的去处是文件，不是每轮提示词
  return readInbox(file).filter((e) => kindOf(e) === MEMORY_KIND)
    .filter((e) => e.status === STATUS.confirmed || (allowLegacy && e.status === STATUS.legacy))
}

/** 待人工处理的条目（proposed 候选 + legacy 老格式），带重放视图序号，供 CLI / 面板确认或否决 */
export function readPending(file) {
  return readInbox(file)
    .map((e, index) => ({ ...e, index }))
    .filter((e) => e.status !== STATUS.confirmed)
}

/**
 * 生成"确认重放视图第 index 条"的 confirm 行（人工确认动作，AI 不许调用）。
 * 物理仍然只追加：确认不改写原行，只是追加一行操作行。
 */
export function confirmOpFor(rawLines, index) {
  const hit = replayInbox(rawLines)[Number(index)]
  if (!hit) return null
  return JSON.stringify({ op: 'confirm', ref: hit.text, at: new Date().toISOString() })
}

/** 生成"否决重放视图第 index 条"的 reject 行（人工动作） */
export function rejectOpFor(rawLines, index) {
  const hit = replayInbox(rawLines)[Number(index)]
  if (!hit) return null
  return JSON.stringify({ op: 'reject', ref: hit.text, at: new Date().toISOString() })
}

/**
 * 生成"删除重放视图第 index 条"所需的 drop 行（UI 删除/晋升用）。
 * 返回 JSON 行字符串或 null（越界）；调用方 appendFileSync 追加——
 * 不做读改写整文件（并发追加不丢行、末尾换行不丢、CRLF 不被归一）。
 * 注意：ref 按折叠后原文首匹配，两条同文条目时删的是第一条。
 */
export function dropOpFor(rawLines, index) {
  const hit = replayInbox(rawLines)[Number(index)]
  if (!hit) return null
  return JSON.stringify({ op: 'drop', ref: hit.text, at: new Date().toISOString() })
}

/**
 * 生成"把重放视图第 index 条改成某层级"的 retier 行（人工动作；AI 只能建议，不能自己改）。
 * 物理仍然只追加：层级变更不改写原行，重放时按行序生效。
 */
export function retierOpFor(rawLines, index, tier) {
  const t = normTier(tier)
  if (!t) return null
  const hit = replayInbox(rawLines)[Number(index)]
  if (!hit) return null
  return JSON.stringify({ op: 'retier', ref: hit.text, tier: t, at: new Date().toISOString() })
}
