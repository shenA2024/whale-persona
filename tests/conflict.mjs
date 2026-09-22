// 共存 / 冲突降级单测（0.14.0）：段注册撞名不炸树 + doctor 的核心判据
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = mkdtempSync(path.join(os.tmpdir(), 'whale-persona-conflict-'))
process.env.DSH_HOME = tmp
process.env.DSH_WHALE_CONFIG = path.join(tmp, 'whale-persona', 'config.json')
mkdirSync(path.join(tmp, 'whale-persona'), { recursive: true })
writeFileSync(process.env.DSH_WHALE_CONFIG, JSON.stringify({
  enabled: true,
  persona: { enabled: true, selfNameFlash: '小助手', userName: '小林', character: '你是{selfName}。' },
}), 'utf8')

const t = (name, ok) => { console.log(name + ':', ok); if (!ok) process.exitCode = 1 }

const { apply } = await import('../adapters/dsh/index.js')

// T1 宿主对同名段抛错（模拟「别的插件已经占了 deployment:persona-prefix」）：
//    我们的 apply() 必须不抛，其它段照常注册
const box = {}
const warnings = []
const origWarn = console.warn
console.warn = (...a) => { warnings.push(a.join(' ')) }
let dispose = null
let threw = null
try {
  dispose = apply({
    systemPrompt: {
      section: (s) => {
        if (s.name === 'deployment:persona-prefix') throw new Error('prompt section "deployment:persona-prefix" is already registered')
        box[s.name] = s
        return () => {}
      },
    },
  })
} catch (e) { threw = e }
t('T1a 撞名的段被吞掉、apply 不抛', threw === null && typeof dispose === 'function')
t('T1b 另外两段照常注册', !!box['deployment:persona-suffix'] && !!box['whale:thinking-language'])
t('T1c 撞名的那段确实缺席（不是假装注册了）', !box['deployment:persona-prefix'])
t('T1d 留下了能被看见的警告', warnings.some((w) => w.includes('段注册失败')) && warnings.some((w) => w.includes('doctor')))
t('T1e dispose 可调用且不抛', (() => { try { dispose(); return true } catch { return false } })())

// T2 全段都撞：apply 仍不抛、返回可用 dispose
let dispose2 = null
let threw2 = null
try {
  dispose2 = apply({ systemPrompt: { section: () => { throw new Error('already registered') } } })
} catch (e) { threw2 = e }
t('T2 全撞也不炸树', threw2 === null && (() => { try { dispose2(); return true } catch { return false } })())
console.warn = origWarn

// T3 doctor 判据：只扫包入口，不递归；能认出同名段/命令
const { claimsOf, entryFiles, mountedNames } = await import('../scripts/doctor.mjs')
const pkg = path.join(tmp, 'fixture-pkg')
mkdirSync(path.join(pkg, 'node_modules', 'nested'), { recursive: true })
writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'x', main: './index.js' }), 'utf8')
writeFileSync(path.join(pkg, 'index.js'), "ctx.systemPrompt.section({ name: 'deployment:persona-prefix' })\ncommands.register({ name: 'memory' })\n", 'utf8')
writeFileSync(path.join(pkg, 'node_modules', 'nested', 'deep.js'), "const s = 'whale:persona-global'\n", 'utf8')
const claims = claimsOf(pkg)
t('T3a 认出同名段', claims.includes('section:deployment:persona-prefix'))
t('T3b 认出同名命令', claims.includes('command:memory'))
t('T3c 不递归 node_modules（入口扫描足够快）', entryFiles(pkg).every((f) => !f.includes('node_modules')))

// T4 已挂载判据：profile patch 与 agent preset 里的 name: 行都要认
mkdirSync(path.join(tmp, 'profiles', 'web'), { recursive: true })
mkdirSync(path.join(tmp, '.agent-presets', 'whale'), { recursive: true })
writeFileSync(path.join(tmp, 'profiles', 'web', 'cordis.patch.yml'), "- insert:\n    - id: whale-persona-ui\n      name: 'whale-persona-ui'\n", 'utf8')
writeFileSync(path.join(tmp, '.agent-presets', 'whale', 'agent.cordis.yml'), "- id: whale-persona\n  name: 'whale-persona'\n", 'utf8')
const mounted = mountedNames()
t('T4 认出已挂载的包名', mounted.has('whale-persona') && mounted.has('whale-persona-ui'))
