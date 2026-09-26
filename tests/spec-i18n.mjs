/**
 * SPEC.md（中文，规范真源）与 SPEC.en.md（英译）之间的「不漂移」机器判据。
 *
 * 背景：英译一旦和中文版各自演进，就成了两份会分叉的文档 —— 那正是本仓反复写测试防的失效模式。
 * 所以英译上线的前提是：漂移可检测。本文件把四条判据固化成断言，挂进 `npm test`。
 *
 * 判据（不是"看起来像"，是可机器复核）：
 *   I1  两边章节号序列**完全相同**（§2.3.1.1 这种四级号也在内）
 *   I2  中文版出现的反引号标识符集合 ⊆ 英文版（字段名 / 路径 / 常量 / §N 交叉引用一个都不许漏）
 *   I3  规范关键词 MUST / MUST NOT / SHOULD / MAY 的条数，英文版 ≥ 中文版（漏掉一条约束即红）
 *   I4  固定文案块（首行以【开头，以及思考语言块）在英文版里**逐字存在** —— 固定文案是互操作的一部分，
 *      不许被"意译"（顺序清单那种说明性列表不在此列，它可以译）
 */
import fs from 'node:fs'
import assert from 'node:assert/strict'

const ZH = 'SPEC.md'
const EN = 'SPEC.en.md'

const zh = fs.readFileSync(ZH, 'utf8')
const en = fs.readFileSync(EN, 'utf8')

const sections = (s) => [...s.matchAll(/^#{2,5}\s+(\d+(?:\.\d+)*)/gm)].map((m) => m[1])
const idents = (s) => new Set(
  [...s.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]).filter((t) => /[A-Za-z]/.test(t)),
)
const fences = (s) => (s.match(/^```/gm) || []).length
const keywordCount = (s, kw) => (s.match(new RegExp('\\b' + kw.replace(' ', '\\s+') + '\\b', 'g')) || []).length
const blocks = (s) => [...s.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1])

let failed = 0
function ok(name, fn) {
  try { fn(); console.log('  ok   ' + name) } catch (e) { failed++; console.log('  FAIL ' + name + ' :: ' + e.message) }
}

console.log('spec-i18n：' + ZH + ' ↔ ' + EN)

// I1 章节号序列一致
ok('I1 章节号序列完全一致', () => {
  const a = sections(zh), b = sections(en)
  assert.ok(a.length > 30, '中文版章节数异常：' + a.length)
  assert.deepEqual(b, a, '英文版章节号与中文版不同步')
})

// I2 标识符集合：中文版 ⊆ 英文版
ok('I2 中文版反引号标识符全部出现在英文版', () => {
  const a = idents(zh), b = idents(en)
  assert.ok(a.size > 100, '中文版标识符数异常：' + a.size)
  const missing = [...a].filter((t) => !b.has(t))
  assert.equal(missing.length, 0, '英文版缺这些标识符：' + missing.slice(0, 12).join(' | '))
})

// I3 规范关键词条数
ok('I3 规范关键词条数 英文版 ≥ 中文版', () => {
  for (const kw of ['MUST', 'MUST NOT', 'SHOULD', 'MAY']) {
    const a = keywordCount(zh, kw), b = keywordCount(en, kw)
    assert.ok(b >= a, kw + '：中文 ' + a + ' → 英文 ' + b + '（英文版漏了约束）')
  }
})

// I4 注入文案块逐字一致（只查含【的块：那些是固定文案，必须逐字）
ok('I4 固定文案块在英文版逐字存在', () => {
  const LITERAL = ['【', '# 内部思考语言']
  const isLiteral = (b) => LITERAL.some((pfx) => b.trim().startsWith(pfx))
  const z = blocks(zh).filter(isLiteral)
  assert.ok(z.length >= 5, '中文版注入文案块数异常：' + z.length)
  const missing = z.filter((b) => !en.includes(b.trim()))
  assert.equal(missing.length, 0, '英文版缺/改了这些文案块：' + missing.map((b) => b.trim().split('\n')[0]).join(' | '))
})

// 附带读数（不参与判定，供人眼看规模差）
console.log('  读数 章节 ' + sections(zh).length + '/' + sections(en).length +
  ' · 围栏 ' + fences(zh) + '/' + fences(en) +
  ' · 标识符 ' + idents(zh).size + '/' + idents(en).size +
  ' · MUST ' + keywordCount(zh, 'MUST') + '/' + keywordCount(en, 'MUST'))

if (failed) { console.log('spec-i18n：' + failed + ' 项红'); process.exit(1) }
console.log('spec-i18n：全绿（4 项判据）')
