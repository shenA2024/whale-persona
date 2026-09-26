// ZCode 适配器测试：hook 脚本（stdin→additionalContext）、preview 模式、降级纪律、vendor 一致性
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const tmp = mkdtempSync(path.join(os.tmpdir(), 'whale-persona-zcode-'))
const cfgFile = path.join(tmp, 'config.json')
const inboxFile = path.join(tmp, 'memory-inbox.jsonl')
const HOOK = path.join(ROOT, 'adapters', 'zcode', 'hooks', 'render.mjs')

const env = { ...process.env, WHALE_PERSONA_CONFIG: cfgFile, DSH_HOME: tmp, DSH_WHALE_CONFIG: cfgFile }

// 断言助手：false 必须非零退出（跑器/CI 只认退出码，纯 console.log 会漏放坏改）
const t = (name, ok) => {
  console.log(name + ':', ok)
  if (!ok) process.exitCode = 1
}

const runHook = (stdin, extraEnv = {}) => spawnSync(process.execPath, [HOOK], {
  input: stdin, encoding: 'utf8', env: { ...env, ...extraEnv },
})

// 夹具：完整人设 + 收件箱一条
writeFileSync(inboxFile, JSON.stringify({ text: '红线：游戏存档目录永远不碰', at: '2026-09-18T01:00:00Z' }) + '\n', 'utf8')
writeFileSync(cfgFile, JSON.stringify({
  enabled: true,
  thinkingLanguage: 'zh-CN',
  persona: {
    enabled: true, selfNameFlash: '小助手', selfNamePro: '首席助手', userName: '小林',
    stance: '{userName}的编程搭档。', character: '你是{selfName}。',
    contracts: [{ id: 'terse', text: '结论先行。', on: true }],
    suffix: '工作目录在 {{cwd}}。',
  },
  memory: { enabled: true, capture: 'always', entries: [], inbox: true, inboxPath: inboxFile, requireConfirm: false },
}), 'utf8')

// Z1 完整渲染：additionalContext 含 stance/character/契约/思维链语言/收件箱数据块/suffix(cwd 替换)
{
  const r = runHook(JSON.stringify({ prompt: 'hi', cwd: 'D:/work', model: 'deepseek-v4.1-flash' }))
  const out = JSON.parse(r.stdout)
  const ctx = out && out.hookSpecificOutput && out.hookSpecificOutput.additionalContext
  t('Z1 exit0:', r.status === 0)
  t('Z1 事件名:', out.hookSpecificOutput.hookEventName === 'UserPromptSubmit')
  t('Z1 persona:', ctx.includes('小林的编程搭档。') && ctx.includes('你是小助手。') && ctx.includes('结论先行。'))
  t('Z1 思维链语言:', ctx.includes('内部思考语言') && ctx.includes('简体中文'))
  t('Z1 收件箱数据块:', ctx.includes('历史备忘') && ctx.includes('「红线：游戏存档目录永远不碰」'))
  t('Z1 suffix(cwd替换):', ctx.includes('工作目录在 D:/work。'))
}

// Z2 pro 模型 → selfNamePro 分档
{
  const r = runHook(JSON.stringify({ model: 'glm-5-pro' }))
  const out = JSON.parse(r.stdout)
  t('Z2 pro分档:', out.hookSpecificOutput.additionalContext.includes('你是首席助手。'))
}

// Z3 纯默认（空对象配置）→ 输出为空（装上不改行为）
{
  writeFileSync(cfgFile, JSON.stringify({}), 'utf8')
  const r = runHook('{}')
  t('Z3 纯默认输出空:', r.status === 0 && r.stdout === '')
}

// Z4 坏 stdin / 坏 JSON 配置 → 安静 exit 0，不炸
{
  const r1 = runHook('this is not json')
  writeFileSync(cfgFile, '{broken json', 'utf8')
  const r2 = runHook('{}')
  writeFileSync(cfgFile, JSON.stringify({ enabled: true, persona: { enabled: true, character: 'x' } }), 'utf8')
  t('Z4 坏stdin安静:', r1.status === 0 && r1.stdout === '')
  t('Z4 坏config安静:', r2.status === 0 && r2.stdout === '')
}

// Z5 config 不存在（首次安装）→ 纯默认空输出
{
  const r = runHook('{}', { WHALE_PERSONA_CONFIG: path.join(tmp, 'nope.json'), DSH_WHALE_CONFIG: path.join(tmp, 'nope2.json') })
  t('Z5 无config安静:', r.status === 0 && r.stdout === '')
}

// Z6 preview 模式：直接打印渲染全文（skill 预览/静态导出用）
{
  writeFileSync(cfgFile, JSON.stringify({
    enabled: true,
    persona: { enabled: true, selfNameFlash: '小助手', character: '预览模式测试。' },
  }), 'utf8')
  const r = spawnSync(process.execPath, [HOOK, '--preview'], { encoding: 'utf8', env })
  t('Z6 preview:', r.status === 0 && r.stdout.includes('预览模式测试。'))
}

// Z7 vendor 与 core 一致（忘了跑 sync-core 时这里红）
{
  const hash = (f) => createHash('sha256').update(readFileSync(f)).digest('hex')
  const coreDir = path.join(ROOT, 'core')
  const vendorDir = path.join(ROOT, 'adapters', 'zcode', 'vendor', 'core')
  // 清单**动态取 core/ 下全部 .js**：2026-09-20 踩到 —— 原来写死 5 个文件，edit.js 不在里面，
// 于是 vendor 的 edit.js 陈旧了一个版本（0.11.2 的收件箱口径修复没同步）却一直绿灯。
const files = readdirSync(coreDir).filter((f) => f.endsWith('.js')).sort()
  const allSame = files.every((f) => existsSync(path.join(vendorDir, f)) && hash(path.join(coreDir, f)) === hash(path.join(vendorDir, f)))
  t('Z7 vendor与core一致:', allSame)
}

// Z8 相关性注入（cwd 穿透钩子）：tag 命中当前目录的条目挤掉更旧的全局条目；纪律含三类候选
{
  writeFileSync(cfgFile, JSON.stringify({
    enabled: true,
    persona: { enabled: true, selfNameFlash: '小助手', character: '你是{selfName}。' },
    memory: { enabled: true, capture: 'always', maxEntries: 1, inbox: true, inboxPath: inboxFile, requireConfirm: false },
  }), 'utf8')
  writeFileSync(inboxFile, [
    JSON.stringify({ text: '全局旧偏好', at: 't1' }),
    JSON.stringify({ text: '项目事实', at: 't2', tag: 'work' }),
  ].join('\n') + '\n', 'utf8')
  const r = runHook(JSON.stringify({ prompt: 'hi', cwd: 'D:/work' }))
  const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext
  // 0.17.0 起被挤出正文的条目改为进【记忆目录】索引（不再静默消失）：正文块无、目录块有
  const z8head = ctx.split('【记忆目录')[0]
  const z8tail = ctx.split('【记忆目录')[1] || ''
  t('Z8 相关性注入:', ctx.includes('「项目事实（work）」') && !z8head.includes('全局旧偏好') && z8tail.includes('全局旧偏好'))
  t('Z8 纪律三类候选:', ctx.includes('[新增]') && ctx.includes('[更新]') && ctx.includes('[删去]'))
}

// Z10 收口开关（ZCode 版 = 消息前缀）：【历史备忘】常驻；【入库纪律】只在带 #记忆 的那一轮
{
  writeFileSync(cfgFile, JSON.stringify({
    enabled: true,
    persona: { enabled: true, selfNameFlash: '小助手', character: '你是{selfName}。' },
    memory: { enabled: true, inbox: true, inboxPath: inboxFile, requireConfirm: false },
  }), 'utf8')
  writeFileSync(inboxFile, JSON.stringify({ text: '常驻记忆条目', at: 't1' }) + '\n', 'utf8')
  const onR = runHook(JSON.stringify({ prompt: '总结一下 #记忆', cwd: 'D:/work' }))
  const offR = runHook(JSON.stringify({ prompt: '普通一句', cwd: 'D:/work' }))
  const onCtx = JSON.parse(onR.stdout).hookSpecificOutput.additionalContext
  const offCtx = JSON.parse(offR.stdout).hookSpecificOutput.additionalContext
  t('Z10 前缀触发:', onCtx.includes('入库纪律') && !offCtx.includes('入库纪律')
    && onCtx.includes('「常驻记忆条目」') && offCtx.includes('「常驻记忆条目」'))
}

// Z9 旧布局兼容：只给 DSH_HOME，配置放在 whale-suite/ 里，hook 也能定位到并注入
{
  const legacyHome = mkdtempSync(path.join(os.tmpdir(), 'whale-persona-zcode-legacy-'))
  mkdirSync(path.join(legacyHome, 'whale-suite'), { recursive: true })
  writeFileSync(path.join(legacyHome, 'whale-suite', 'config.json'), JSON.stringify({
    enabled: true, persona: { enabled: true, selfNameFlash: '小助手', character: '你是{selfName}。' },
  }), 'utf8')
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ prompt: 'hi' }), encoding: 'utf8',
    env: { ...process.env, DSH_HOME: legacyHome, WHALE_PERSONA_CONFIG: '', DSH_WHALE_CONFIG: '' },
  })
  let ok = false
  try { ok = JSON.parse(r.stdout).hookSpecificOutput.additionalContext.includes('你是小助手。') } catch { /* 解析失败即失败 */ }
  t('Z9 旧布局兼容:', ok)
}
