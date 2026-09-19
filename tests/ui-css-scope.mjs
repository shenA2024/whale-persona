// 样式作用域门（2026-09-19 新增；同日收口：品牌层与外观开关按用户要求砍掉，只留基础层）
// 背景：2026-09-19 用户反馈「有人会装别的插件美化全部 UI，再装我们的会冲突」，随后拍板「还是不要颜色了」。
// 结论：共存靠的不是"少改几个地方"，而是"一层都不多、且只落在 .wpr-* 里、只用宿主变量"。
// 所以 C1–C6 是基础层的作用域门（一条都不许弱化），C7–C11 把「不存在第二层」也钉成机检断言。
// 断言强制：任一 false 即非零退出。
import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const home = mkdtempSync(path.join(os.tmpdir(), 'whale-persona-css-'))
process.env.DSH_HOME = home
process.env.DSH_WHALE_CONFIG = path.join(home, 'whale-persona', 'config.json')

const t = (name, ok) => { console.log(name + ':', ok); if (!ok) process.exitCode = 1 }

// —— 用与 tests/ui-panel.mjs 同一套桩加载浏览器半身，拿它真正注入的那段 CSS ——
let loaded = null
let hooks = null
globalThis.window = { __ModuleLoader__: { load: (m) => { loaded = m } } }
globalThis.__WPR_TEST_HOOK__ = (api) => { hooks = api }
const ReactStub = {
  createElement: function (type, props) {
    const kids = Array.prototype.slice.call(arguments, 2)
    return { type, props: Object.assign({}, props, kids.length ? { children: kids.length === 1 ? kids[0] : kids } : {}) }
  },
  useState: (v) => [v, () => {}], useEffect: () => {}, useRef: (v) => ({ current: v }), useCallback: (f) => f,
}
/** 假 document：只为数清「注入了几个 style 标签」——createElement('style') 进 tags，remove() 摘掉 */
function fakeDoc() {
  const tags = []
  const mk = () => {
    const el = {
      dataset: {}, textContent: '', style: {}, setAttribute() {}, appendChild() {},
      remove() { const i = tags.indexOf(el); if (i >= 0) tags.splice(i, 1) },
    }
    return el
  }
  return {
    tags,
    head: { appendChild(el) { tags.push(el) } },
    body: { appendChild() {}, removeChild() {} },
    createElement: mk,
    querySelectorAll(sel) { return tags.filter((el) => sel.indexOf(String(el.dataset.plugin || '')) >= 0) },
  }
}
const FAKE_DOC = fakeDoc()
globalThis.document = FAKE_DOC

await import('../adapters/dsh-ui/client.js')
const clientExports = loaded.factory((id) => {
  if (id === 'react') return ReactStub
  throw new Error('意外的 require：' + id)
})
clientExports.apply({ effect: (fn) => { fn(); return () => {} }, slots: { inject: () => {}, register: () => {} } })

const css = String(hooks.css || '')

/** 剥掉注释（注释里出现"!important / :root"这类字样不算违规） */
const strip = (s) => String(s).replace(/\/\*[\s\S]*?\*\//g, '')

/** 抽选择器：以 '{' 前的一段为选择器；@media/@keyframes 与关键帧百分比跳过 */
function selectors(src) {
  const out = []
  const re = /([^{}]+)\{/g
  let m
  const s = strip(src)
  while ((m = re.exec(s))) {
    const sel = m[1].trim()
    if (!sel) continue
    if (sel.startsWith('@')) continue
    if (/^(from|to|\d+%)(\s*,\s*(from|to|\d+%))*$/.test(sel)) continue
    out.push(sel)
  }
  return out
}
const offenders = (sels) => sels.filter((sel) => sel.split(',').some((part) => !part.includes('.wpr-')))

const sels = selectors(css)
const badBase = offenders(sels)
t('C1 基础层确实有规则（不是空串）', sels.length >= 20)
t('C2 基础层每个选择器都落在 .wpr-* 作用域内', badBase.length === 0)
if (badBase.length) console.log('   越界选择器：' + JSON.stringify(badBase.slice(0, 8)))
t('C3 基础层没有 !important', !/!important/.test(strip(css)))
t('C4 基础层不碰 :root / html / body', !sels.some((s) => /(^|,)\s*(:root|html|body)\b/.test(s)))
t('C5 基础层不定义宿主变量（不出现 --dsw-*: 声明）', !/--dsw-[a-z0-9-]+\s*:/.test(strip(css)))
t('C6 基础层颜色确实走宿主变量（var(--dsw-…) 有引用）', (strip(css).match(/var\(--dsw-/g) || []).length > 0)

/* ─────────── C7–C11：不存在第二层样式、也不存在「自带外观」开关 ─────────── */

const tagNames = () => FAKE_DOC.tags.map((el) => String(el.dataset.plugin || ''))
t('C7 注入的 style 标签只有一个，且就是基础层',
  tagNames().length === 1 && tagNames()[0] === 'dsh-whale-persona-ui')

t('C8 钩子里没有第二层的任何接口（brandCss / themeOf / syncThemeLayer / themeOptions）',
  ['brandCss', 'themeOf', 'syncThemeLayer', 'themeOptions'].every((k) => hooks[k] === undefined))

const clientSrc = readFileSync(new URL('../adapters/dsh-ui/client.js', import.meta.url), 'utf8')
t('C9 client.js 源码里没有第二层的标签名与控制键（whale-persona-theme / BRAND_CSS / uiTheme）',
  clientSrc.indexOf('whale-persona-theme') < 0
  && clientSrc.indexOf('BRAND_CSS') < 0
  && clientSrc.indexOf('uiTheme') < 0)

// 渲染树走一遍：配置里**残留** ui 段（上一版或别的工具写的）也不许多注入任何样式，
// 而且面板自己不再生成 ui 段（写不写它由 core 的已知段纪律决定）。
const noop = () => {}
const raw = { enabled: true, ui: { theme: 'brand' }, persona: {}, memory: {} }
const data = hooks.normalize({
  raw, defaults: {}, sections: { prefix: 'P', thinking: 'T', suffix: 'S' },
  contracts: [], memory: {}, enabled: true, thinkingLanguage: 'off',
}, 'flash')
const form = hooks.formFrom(data)
hooks.panelView({
  data, form, disabled: true, tier: 'flash',
  status: { saving: false, saved: false, savedAt: '', error: '' },
  savedPreview: null, loading: false, dirty: false,
  handlers: {
    patchForm: noop, patchAt: noop, removeAt: noop, addAt: noop,
    onPickTier: noop, onRefresh: noop, onSave: noop, onRetry: noop,
  },
})
t('C10 配置里残留 ui 段：不多注入样式、也不被面板写回 patch',
  tagNames().length === 1 && hooks.buildPatch(form, data).ui === undefined)

/** 收集 {type,props} 树里的所有节点（函数组件就调用它拿子树） */
function nodesOf(node, out) {
  const acc = out || []
  if (!node || typeof node !== 'object') return acc
  if (Array.isArray(node)) { node.forEach((n) => nodesOf(n, acc)); return acc }
  if (typeof node.type === 'function') { nodesOf(node.type(node.props || {}), acc); return acc }
  acc.push(node)
  nodesOf(node.props ? node.props.children : null, acc)
  return acc
}
const textOf = (node) => nodesOf(node).map((n) => (typeof n.props.children === 'string' ? n.props.children : '')).join(' ')
const stripTree = hooks.StatusStrip({
  data: { tier: 'flash', tierLabel: 'flash 档', tierRule: '', configPath: '', configState: {} },
  enabled: true, thinkingLanguage: 'off', disabled: false,
  onToggleEnabled: noop, onThinking: noop,
})
const stripNodes = nodesOf(stripTree)
t('C11 状态条里不再有「外观」控件，也不再出现自带外观的开关文案',
  !stripNodes.some((n) => n.type === 'select')
  && textOf(stripTree).indexOf('外观') < 0
  && textOf(stripTree).indexOf('跟随宿主主题') < 0
  && textOf(stripTree).indexOf('使用人设自带外观') < 0)
