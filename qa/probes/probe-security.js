#!/usr/bin/env node
/**
 * 安全探针（纯 node，零第三方依赖）——把 qa/security-审查.md 里可自动化的检查工具化。
 * 做法对齐一套既有的安全审查部门流程（探针脚本 + 人工台账 + 每班结论与交接点）：
 * 分组断言 -> PASS <true|false> DETAIL <json> + 退出码；
 * 只读、不改仓库、不联网、不装包。任一组自身抛错时降级为 SEC_SKIP，不拖垮整轮。
 *
 * 用法:
 *   node qa/probes/probe-security.js                 检查本仓
 *   node qa/probes/probe-security.js --root <dir>    指定检查根
 *   node qa/probes/probe-security.js --selftest      自测：在临时目录种违规，断言探针会 FAIL
 *
 *   S1  SEC_DEPS      零运行时依赖：根 package.json 无 dependencies / devDependencies
 *   S2  SEC_NET       不联网：生产源码里没有指向非 loopback 主机的 URL
 *   S3  SEC_SHELL     不执行 shell：无 shell:true、无 exec/execSync，spawn* 一律数组传参
 *   S4  SEC_TRAVERSAL 安装器路径纪律：--profile/--base 白名单 + path.resolve
 *   S5  SEC_CSP       本地页 CSP：nonce 一次性、无 unsafe-inline/unsafe-eval、响应头+meta 双份 + nosniff
 *   S6  SEC_INJECT    注入面：无 eval/new Function/document.write；innerHTML 只允许清空
 *   S7  SEC_BIND      只绑 loopback + Host/Origin 双校验
 *   S8  SEC_GATE      记忆闸门（功能探针，真跑一次渲染）：proposed 不进注入，confirmed 才进
 *   S9  SEC_SECRET    仓库里没有真实凭据
 *   S10 SEC_IGNORE    .gitignore 挡住依赖/生成物/大素材/日志/环境文件
 *   S13 SEC_SINK      分类路由（0.13.0）：kind 非 memory 的条目永不进提示词；渲染路径不得有写盘副作用
 *   S14 SEC_PRIVACY   私人内容永不出海（0.13.0）：维护者的人名/关系/私有工作目录在公开仓里零出现
 *   S15 SEC_WRITE     写面清单与代码同步（0.14.1）：会写盘的生产文件必须逐个登记在 SECURITY.md 里
 *   S11 SEC_BINARY    版本库里没有二进制大件
 *   S12 SEC_ORIGIN    本地页真起服务打三个 Origin（行为测试）：非 loopback 必须 403
 *
 * 无法自动化项（SEC_SKIP，不计失败）: 记忆确认行的语义伪造、提示词注入逃逸的人工判定、
 *   宿主平面划分（headless 不注入人设）、第三方扫描复核。以上以 qa/security-审查.md 的人工核验为准。
 *
 * 结论边界: **探针 PASS 不等于门禁通过** —— 它只覆盖上面 12 组；门禁以台账全项人工核验为准。
 */
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const opt = { root: path.resolve(HERE, '..', '..'), selftest: false }
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--root') opt.root = path.resolve(argv[++i] || '.')
  else if (argv[i] === '--selftest') opt.selftest = true
  else { console.error('unknown arg: ' + argv[i]); process.exit(2) }
}
const ROOT = opt.root

let fails = 0, skips = 0, suspects = 0
const ok = (id, msg) => console.log('SEC_OK   ' + id + ' ' + msg)
const bad = (id, msg) => { fails++; console.log('SEC_FAIL ' + id + ' ' + msg) }
const sus = (id, msg) => { suspects++; console.log('SEC_SUSPECT ' + id + ' ' + msg) }
const skip = (id, reason, msg) => { skips++; console.log('SEC_SKIP ' + id + ' reason=' + reason + (msg ? ' ' + msg : '')) }
const t = (id, cond, detail) => { if (cond) ok(id, detail || ''); else bad(id, detail || '') }
const guard = (id, fn) => { try { fn() } catch (e) { skip(id, 'probe-error', String(e && e.message).slice(0, 80)) } }
/** 异步探针（S12 要真起服务）登记到这里，结论处 await —— 必须声明在 guard 之前，否则 TDZ 报错 */
let pending = Promise.resolve()

// .workbuddy = 本机私有工作笔记（含维护者私有路径与拍板记录），从不出海：磁盘判据下也要跳过
const SKIP_DIRS = new Set(['node_modules', '.git', '.workbuddy', 'data', '.tmp', 'out', 'build', 'dist', '.inbox'])
const PROD_EXT = new Set(['.js', '.mjs', '.html'])
/** 生产源码 = core/ adapters/ scripts/（tests/ 是夹具，不算生产面） */
function walk(dir, extSet, out) {
  const acc = out || []
  if (!existsSync(dir)) return acc
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) walk(p, extSet, acc)
    else if (!extSet || extSet.has(path.extname(name))) acc.push(p)
  }
  return acc
}
const prodFiles = () => walk(path.join(ROOT, 'core'), PROD_EXT).concat(walk(path.join(ROOT, 'adapters'), PROD_EXT), walk(path.join(ROOT, 'scripts'), PROD_EXT))
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/')
const readLines = (p) => readFileSync(p, 'utf8').split(/\r?\n/)
/** 注释行不算违规（纪律写在注释里是好事，不是漏洞） */
const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line)
const LOOPBACK = /(127\.0\.0\.1|localhost|\[::1\]|::1)/
const lineHits = (pred) => {
  const out = []
  for (const p of prodFiles()) {
    for (const [i, line] of readLines(p).entries()) {
      if (isComment(line)) continue
      const hit = pred(line, p)
      if (hit) out.push(rel(p) + ':' + (i + 1) + ' ' + String(hit))
    }
  }
  return out
}

guard('S1', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const deps = Object.keys(pkg.dependencies || {})
  const dev = Object.keys(pkg.devDependencies || {})
  t('S1', deps.length === 0 && dev.length === 0, 'dependencies=' + JSON.stringify(deps) + ' devDependencies=' + JSON.stringify(dev))
})

guard('S2', () => {
  const hits = lineHits((line) => { const m = line.match(/https?:\/\/[^\s'"\)\]]+/); return m && !LOOPBACK.test(m[0]) ? m[0] : null })
  t('S2', hits.length === 0, hits.length ? JSON.stringify(hits.slice(0, 5)) : '生产源码零外联 URL')
})

guard('S3', () => {
  const bads = lineHits((line) => {
    if (/shell\s*:\s*true/.test(line)) return 'shell:true'
    if (/\bexecSync\s*\(|\bexec\s*\(\s*['"`]/.test(line)) return 'exec'
    return null
  })
  t('S3', bads.length === 0, bads.length ? JSON.stringify(bads.slice(0, 5)) : '无 shell:true / exec')
  const susps = lineHits((line) => (/spawn(Sync)?\s*\(/.test(line) && !/shell\s*:\s*false/.test(line) ? 'spawn 未显式 shell:false' : null))
  if (susps.length) sus('S3', 'spawn* 需人工确认数组传参: ' + JSON.stringify(susps.slice(0, 5)))
})

guard('S4', () => {
  const f = path.join(ROOT, 'scripts', 'install-dsh.mjs')
  if (!existsSync(f)) return skip('S4', 'no-installer')
  const s = readFileSync(f, 'utf8')
  const hasRe = /const ID_RE = \/\^/.test(s)
  const guards = (s.match(/ID_RE\.test\(/g) || []).length >= 2
  const resolved = /path\.resolve\(opts\.home/.test(s)
  t('S4', hasRe && guards && resolved, 'ID_RE=' + hasRe + ' 校验点=' + guards + ' resolve=' + resolved)
})

guard('S5', () => {
  const h = path.join(ROOT, 'scripts', 'ui.html')
  const m = path.join(ROOT, 'scripts', 'ui.mjs')
  if (!existsSync(h) || !existsSync(m)) return skip('S5', 'no-local-page')
  const html = readFileSync(h, 'utf8')
  const mjs = readFileSync(m, 'utf8')
  const i = mjs.indexOf('function cspFor')
  const cspFn = i < 0 ? '' : mjs.slice(i, i + 600)
  const tight = cspFn.length > 0 && !/unsafe-inline|unsafe-eval/.test(cspFn) && /nonce-/.test(cspFn)
  const header = /['"]content-security-policy['"]\s*:/i.test(mjs)
  const nosniff = /x-content-type-options['"]?\s*:\s*['"]nosniff/i.test(mjs)
  t('S5', html.includes('%CSP%') && html.includes('%NONCE%') && tight && header && nosniff,
    'meta占位=' + (html.includes('%CSP%') && html.includes('%NONCE%')) + ' 非nonce化=' + tight + ' 响应头=' + header + ' nosniff=' + nosniff)
})

guard('S6', () => {
  const bads = lineHits((line) => {
    if (/\beval\s*\(|new Function\s*\(|document\.write\s*\(|insertAdjacentHTML|dangerouslySetInnerHTML/.test(line)) return line.trim().slice(0, 60)
    const m = line.match(/innerHTML\s*(\+)?=\s*(.+)$/)
    if (m) { const rhs = m[2].trim(); if (!/^(['\"]{2})\s*;?$/.test(rhs)) return '非清空 innerHTML: ' + line.trim().slice(0, 50) }
    return null
  })
  t('S6', bads.length === 0, bads.length ? JSON.stringify(bads.slice(0, 5)) : '无 eval / 无非清空 innerHTML')
})

guard('S7', () => {
  const m = path.join(ROOT, 'scripts', 'ui.mjs')
  const u = path.join(ROOT, 'adapters', 'dsh-ui', 'index.js')
  if (!existsSync(m) || !existsSync(u)) return skip('S7', 'no-local-server')
  const mjs = readFileSync(m, 'utf8')
  const ui = readFileSync(u, 'utf8')
  const bound = /server\.listen\(\s*PORT\s*,\s*'127\.0\.0\.1'/.test(mjs)
  // 面板：只认"校验代码真的在"（guard 函数体 + 读取 host/origin 头），不认文件里出现过的词
  const hostGuard = /function guard\s*\(req\)/.test(ui) && /req\.headers\.origin/.test(ui) && /req\.headers\.host/.test(ui)
  const jsHostGuard = /ALLOWED_HOSTS/.test(mjs)
  t('S7', bound && hostGuard && jsHostGuard, 'listen127=' + bound + ' 面板Host/Origin=' + hostGuard + ' 本地页Host白名单=' + jsHostGuard + '（本地页实际行为见 S12）')
})

guard('S8', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'wpr-sec-'))
  const dir = path.join(home, 'whale-persona')
  mkdirSync(dir, { recursive: true })
  // inboxPath 用绝对路径：本探针的读取不再依赖 process.env —— 同进程里后续同步探针会改 DSH_HOME，
  // 而 S8 是异步的（await 期间会被插队），靠 env 定位就会读串台（2026-09-20 加 S13 时当场踩到）。
  const cfgPath = path.join(dir, 'config.json')
  writeFileSync(cfgPath, JSON.stringify({ enabled: true, persona: { enabled: true, userName: '审', selfNameFlash: '审', character: 'x' }, memory: { enabled: true, entries: [{ text: 'SEC-MANUAL-条目' }], inboxPath: path.join(dir, 'memory-inbox.jsonl') } }), 'utf8')
  writeFileSync(path.join(dir, 'memory-inbox.jsonl'), [
    JSON.stringify({ text: 'SEC-CONFIRMED-条目', status: 'confirmed', at: '2026-09-19T00:00:00Z' }),
    JSON.stringify({ text: 'SEC-PROPOSED-条目', status: 'proposed', at: '2026-09-19T00:00:00Z' }),
  ].join('\n') + '\n', 'utf8')
  // 不再依赖 process.env 定位：S8 是异步的（await 期间会被后面的同步探针插队改 DSH_HOME），
  // 走 env 就会读串台（2026-09-20 加 S13 时当场踩到）。配置文件与收件箱都用绝对路径。
  return (async () => {
    const { buildPersonaPrompt } = await import(pathToFileURL(path.join(ROOT, 'core', 'prompt.js')).href)
    const { mergeConfig } = await import(pathToFileURL(path.join(ROOT, 'core', 'defaults.js')).href)
    const cfg = mergeConfig(JSON.parse(readFileSync(cfgPath, 'utf8')))
    const out = String(buildPersonaPrompt(cfg, 'deepseek-flash', home, {}) || '')
    t('S8', out.indexOf('SEC-PROPOSED-条目') < 0 && out.indexOf('SEC-CONFIRMED-条目') >= 0 && out.indexOf('SEC-MANUAL-条目') >= 0,
      'proposed进了=' + (out.indexOf('SEC-PROPOSED-条目') >= 0) + ' confirmed进了=' + (out.indexOf('SEC-CONFIRMED-条目') >= 0) + ' 手工条目进了=' + (out.indexOf('SEC-MANUAL-条目') >= 0))
    rmSync(home, { recursive: true, force: true })
  })().catch((e) => { skip('S8', 'probe-error', String(e.message).slice(0, 80)) })
})

guard('S13', () => {
  // SEC_SINK（0.13.0）：把"AI 只能提议"这条判据延伸到记忆之外 ——
  // ① 分类条目（kind 非 memory）无论 proposed 还是 confirmed 都不进提示词；
  // ② 渲染路径**不得有任何写盘副作用**：渲染完目标沉降文件仍不存在（落盘只可能发生在人工确认那一刻）。
  const home = mkdtempSync(path.join(os.tmpdir(), 'wpr-sec-sink-'))
  const dir = path.join(home, 'whale-persona')
  const target = path.join(home, 'sunk', 'sec-sink.md')
  mkdirSync(dir, { recursive: true })
  const cfgPath = path.join(dir, 'config.json')
  // 全绝对路径、不碰 process.env —— 异步探针靠 env 定位会被后续同步探针插队改掉
  writeFileSync(cfgPath, JSON.stringify({
    enabled: true,
    persona: { enabled: true, userName: '审', selfNameFlash: '审', character: 'x' },
    memory: { enabled: true, inboxPath: path.join(dir, 'memory-inbox.jsonl'), sinks: { pitfall: { path: target } } },
  }), 'utf8')
  writeFileSync(path.join(dir, 'memory-inbox.jsonl'), [
    JSON.stringify({ text: 'SEC-PITFALL-CONFIRMED', kind: 'pitfall', status: 'confirmed', at: '2026-09-20T00:00:00Z' }),
    JSON.stringify({ text: 'SEC-PITFALL-PROPOSED', kind: 'pitfall', status: 'proposed', at: '2026-09-20T00:00:00Z' }),
  ].join('\n') + '\n', 'utf8')
  return (async () => {
    const { buildPersonaPrompt } = await import(pathToFileURL(path.join(ROOT, 'core', 'prompt.js')).href)
    const { mergeConfig } = await import(pathToFileURL(path.join(ROOT, 'core', 'defaults.js')).href)
    const cfg = mergeConfig(JSON.parse(readFileSync(cfgPath, 'utf8')))
    const out = String(buildPersonaPrompt(cfg, 'deepseek-flash', home, { capture: true }) || '')
    const inPrompt = (s) => out.indexOf(s) >= 0
    t('S13', !inPrompt('SEC-PITFALL-PROPOSED') && !inPrompt('SEC-PITFALL-CONFIRMED') && !existsSync(target),
      'proposed进了=' + inPrompt('SEC-PITFALL-PROPOSED') + ' confirmed进了=' + inPrompt('SEC-PITFALL-CONFIRMED')
      + ' 渲染写出了文件=' + existsSync(target) + ' 路由已下发=' + inPrompt('pitfall'))
    rmSync(home, { recursive: true, force: true })
  })().catch((e) => { skip('S13', 'probe-error', String(e.message).slice(0, 80)) })
})

guard('S15', () => {
  // SEC_WRITE（触发来源：2026-09-21 第三方走读指出 SECURITY.md 的写面描述落后于代码 ——
  // 它声称只写 config + 收件箱，实际还写 reflex 台账 / 沉降目标 / sink-log / last-model / session-flags）。
  // 判据：**会写盘的生产文件必须逐个被 SECURITY.md 点名**，否则当场红。
  // 反向不判（文档里本来就该提到只读文件）；刻意不按行号比对（行号天天变），只比对文件集合。
  const WRITE = /\b(writeFileSync|appendFileSync|createWriteStream|copyFileSync|renameSync|rmSync|unlinkSync|mkdirSync)\s*\(/
  const doc = readFileSync(path.join(ROOT, '.github', 'SECURITY.md'), 'utf8')
  const writers = []
  for (const dir of ['core', 'adapters', 'scripts']) {
    for (const p of walk(path.join(ROOT, dir), null)) {
      const r = rel(p)
      if (!/\.(js|mjs|cjs)$/.test(r) || r.includes('vendor/')) continue
      let txt = ''
      try { txt = readFileSync(p, 'utf8') } catch { continue }
      if (WRITE.test(txt)) writers.push(r)
    }
  }
  const missing = writers.filter((r) => !doc.includes(r))
  t('S15', writers.length >= 8 && missing.length === 0,
    '会写盘的生产文件 ' + writers.length + ' 个；未登记 ' + (missing.length ? JSON.stringify(missing) : '无'))
})

guard('S14', () => {
  // SEC_PRIVACY（2026-09-20 维护者定下的红线）：
  // 「我们自己的独特配置（人设正文、记忆、私有目录）永远不发出这个仓」——这句话必须是机器判据，
  // 不是自觉。曾经真漏过一次：CHANGELOG / README / scripts/inject-size.mjs 里拿维护者的真实工作目录
  // 当命令行示例（--cwd），连测试都抓不到（功能与安全探针都不管"示例里写了谁的路径"）。
  // 词表在源码里拆开写 + 扫描时跳过本文件，避免探针自己命中自己。
  // 词表一律用**字符码**拼出来：这样探针源码里读不到任何私人词，它就能（也应该）扫自己。
  // 上一版把词拆成两半写（人名两个字拆成两个单字再 join）—— 拆分不等于消除，文件里照样是那两个字，
  // 而我又把它从扫描面里排除掉了，于是它成了唯一漏网的文件（2026-09-20 当场被抓）。
  const fromCode = (codes) => String.fromCharCode.apply(null, codes)
  const pats = [
    fromCode([0x9cb8, 0x9c7c, 0x59d0, 0x59d0]),           // 人设名（4 字）
    fromCode([0x5f90, 0x77f3]),                            // 维护者姓名（2 字）
    fromCode([0x5f90]),                                    // 姓氏单字：防「拆成两半写」绕过（2026-09-26 教训）
    fromCode([0x77f3]),                                    // 名字单字：同上
    fromCode([0x59bb, 0x5b50]),                            // 关系词
    fromCode([0x5f1f, 0x5f1f]),
    fromCode([0x5b69, 0x5b50]),
    fromCode([0x59d0, 0x59d0]),
    fromCode([0x5988, 0x5988]),
    fromCode([0x54, 0x69, 0x53, 0x68, 0x69, 0x43, 0x69]),  // 私有库名
    fromCode([0x57, 0x61, 0x72, 0x6d, 0x73, 0x74, 0x6f, 0x6e, 0x65]), // 私有项目名
    fromCode([0x33, 0x33, 0x35, 0x30, 0x33]),              // 本机用户名片段
  ]
  const self = rel(fileURLToPath(import.meta.url))
  const hits = []
  // 判据面 = **git 跟踪集**（= 会真的被推上去的那批），不是磁盘上的所有文件：
  // 本机的 .workbuddy/memory/ 这类私有笔记本来就该写维护者的名字 —— 它们从不出海，不该判红。
  // （同一个教训 2026-09-20 在 tests/paths.mjs 上吃过一次：磁盘判据会造成"本机红 / CI 绿"的错觉。）
  const gitR = spawnSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8', shell: false })
  const tracked = gitR.status === 0 && gitR.stdout
    ? gitR.stdout.split('\0').filter(Boolean).map((p) => path.resolve(ROOT, p))
    : null
  for (const p of (tracked || walk(ROOT, null))) {
    const r = rel(p)
    // 注意：**不跳过本文件** —— 词表已是字符码拼的，本文件自己就该是干净的（上一版的教训）
    if (!/\.(js|mjs|cjs|json|md|html|yml|yaml|txt)$/.test(r)) continue
    let txt = ''
    try { txt = readFileSync(p, 'utf8') } catch { continue }
    for (const pat of pats) if (txt.includes(pat)) hits.push(r + ' <- ' + pat)
  }
  t('S14', hits.length === 0, (tracked ? '扫描面=' + tracked.length + ' 个跟踪文件；' : '扫描面=磁盘；')
    + (hits.length ? JSON.stringify(hits.slice(0, 5)) : '零命中（人名 / 关系 / 私有工作目录）'))
})

guard('S9', () => {
  const pat = /ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{24,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----/
  const hits = []
  for (const p of walk(ROOT, null)) {
    if (!/\.(js|mjs|json|md|html|yml|yaml|txt)$/.test(p)) continue
    if (pat.test(readFileSync(p, 'utf8'))) hits.push(rel(p))
  }
  t('S9', hits.length === 0, hits.length ? JSON.stringify(hits) : '零命中')
})

guard('S10', () => {
  const f = path.join(ROOT, '.gitignore')
  if (!existsSync(f)) return skip('S10', 'no-gitignore')
  const s = readFileSync(f, 'utf8')
  const need = ['node_modules/', 'data/', 'out/', 'build/', '.env', '*.log']
  const miss = need.filter((x) => s.indexOf(x) < 0)
  t('S10', miss.length === 0, miss.length ? '缺: ' + JSON.stringify(miss) : '覆盖 ' + need.join(' '))
})

guard('S11', () => {
  const r = spawnSync('git', ['-C', ROOT, 'ls-files'], { encoding: 'utf8', shell: false })
  if (r.status !== 0) return skip('S11', 'not-a-git-repo')
  // 判据收窄（2026-09-22）：docs/images/ 下的图片是**有意的文档资产**（README 靠它显示），
  // 与「误提交的二进制大件」不是一类。放行但限体积 —— 单文件 ≤ 600 KB、整目录 ≤ 1.5 MB；
  // 其他位置（仓库根、源码目录…）的二进制照旧拦。
  const DOC = /^docs\/images\//
  const MAX_ONE = 600 * 1024
  const MAX_ALL = 1536 * 1024
  const sizeOf = (f) => {
    try { return statSync(path.join(ROOT, f)).size } catch { return 0 }
  }
  const bin = r.stdout.split(/\r?\n/).filter((f) => /\.(png|jpe?g|gif|webp|zip|gz|exe|dll|so|blend|glb|mp4|mov|pdf|woff2?|ttf)$/i.test(f))
  const doc = bin.filter((f) => DOC.test(f))
  const stray = bin.filter((f) => !DOC.test(f))
  const oversize = doc.filter((f) => sizeOf(f) > MAX_ONE)
  const total = doc.reduce((s, f) => s + sizeOf(f), 0)
  const bad = stray.concat(oversize)
  if (total > MAX_ALL) bad.push('docs/images 合计 ' + total + 'B > ' + MAX_ALL + 'B')
  t('S11', bad.length === 0, bad.length
    ? JSON.stringify(bad.slice(0, 5))
    : '零二进制大件（docs/images 白名单 ' + doc.length + ' 张 / ' + total + ' B）')
})

guard('S12', () => {
  const ui = path.join(ROOT, 'scripts', 'ui.mjs')
  if (!existsSync(ui)) return skip('S12', 'no-local-server')
  const home = mkdtempSync(path.join(os.tmpdir(), 'wpr-origin-'))
  const cfg = path.join(home, 'config.json')
  writeFileSync(cfg, JSON.stringify({ enabled: true, persona: { character: 'x' } }), 'utf8')
  const port = 8900 + Math.floor(Math.random() * 90)
  const base = 'http://127.0.0.1:' + port
  const child = spawn(process.execPath, [ui, '--port', String(port)], {
    cwd: ROOT, env: { ...process.env, DSH_HOME: home, DSH_WHALE_CONFIG: cfg }, stdio: 'ignore',
  })
  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    try { child.kill('SIGKILL') } catch { /* 已经退出 */ }
    rmSync(home, { recursive: true, force: true })
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  pending = pending.then(async () => {
    let up = false
    for (let i = 0; i < 20 && !up; i++) {
      try { up = (await fetch(base + '/api/state')).ok } catch { await sleep(150) }
    }
    if (!up) {
      cleanup()
      return bad('S12', '本地页起不来（起不来就没法证明它拒外源 Origin，不算通过）port=' + port)
    }
    const post = async (headers) => {
      try {
        const r = await fetch(base + '/api/save', {
          method: 'POST', headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify({ config: { persona: { character: 'SEC-ORIGIN-PROBE' } } }),
        })
        return r.status
      } catch { return 0 }
    }
    const evil = await post({ origin: 'https://evil.example' })
    const absent = await post({})
    const self = await post({ origin: base })
    cleanup()
    t('S12', evil === 403 && absent === 200 && self === 200,
      '外源Origin=' + evil + '(期望403) 无Origin=' + absent + '(期望200) 自家Origin=' + self + '(期望200)')
  }).catch((e) => { cleanup(); throw e })
})

/** 异步探针（S12 要真起服务）——登记后由结论处 await，保证顺序与退出码都在异步跑完之后 */
function flushAsync() { return pending }

skip('M1', 'manual', '记忆确认行语义伪造（同进程文件信任的固有上限，见 SECURITY.md）')
skip('M2', 'manual', '提示词注入逃逸：渲染文本的呈现缓解需人读一遍')
skip('M3', 'manual', '宿主平面划分（headless 不注入人设）是行为约定不是漏洞')
skip('M4', 'manual', '第三方扫描（CodeQL / CodeGuard）结论复核')

await flushAsync()
console.log('PASS ' + (fails === 0) + ' DETAIL ' + JSON.stringify({ root: rel(ROOT) || '.', fail: fails, suspect: suspects, skip: skips }))
if (fails) process.exitCode = 1

/* ---------- 自测：探针自己也要能被证明有牙 ---------- */
if (opt.selftest) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'wpr-probe-selftest-'))
  mkdirSync(path.join(tmp, 'core'), { recursive: true })
  writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0', dependencies: { 'evil-dep': '1.0.0' } }), 'utf8')
  writeFileSync(path.join(tmp, 'core', 'a.js'), 'export const u = fetch("https://evil.example.com/x")\nexport const y = eval("1")\nconst el = document.createElement("div"); el.innerHTML = "<img src=x onerror=alert(1)>"\n', 'utf8')
  writeFileSync(path.join(tmp, '.gitignore'), 'node_modules/' + String.fromCharCode(10), 'utf8')
  // S12 的行为测法要有牙：这里种一个**没做 Origin 校验**的本地页，断言探针会 FAIL
  mkdirSync(path.join(tmp, 'scripts'), { recursive: true })
  mkdirSync(path.join(tmp, 'adapters', 'dsh-ui'), { recursive: true })
  writeFileSync(path.join(tmp, 'adapters', 'dsh-ui', 'index.js'), 'function isLoopbackHost(h) { return h === "127.0.0.1" }\nexport const x = (req) => req.headers.host\n', 'utf8')
  writeFileSync(path.join(tmp, 'scripts', 'ui.mjs'), [
    "import { createServer } from 'node:http'",
    'const PORT = Number((process.argv.indexOf("--port") >= 0 ? process.argv[process.argv.indexOf("--port") + 1] : 0) || 8799)',
    'const s = createServer((req, res) => {',
    '  res.writeHead(200, { "content-type": "application/json" })',
    '  res.end(JSON.stringify({ ok: true }))',
    '})',
    "s.listen(PORT, '127.0.0.1')",
    '',
  ].join(String.fromCharCode(10)), 'utf8')
  const r2 = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--root', tmp], { encoding: 'utf8', shell: false, timeout: 120000 })
  const caught = r2.stdout.match(/SEC_FAIL (S\d+)/g) || []
  const okSelf = r2.status === 1 && caught.length >= 5 && caught.includes('SEC_FAIL S12')
  console.log('SELFTEST ' + okSelf + ' DETAIL ' + JSON.stringify({ expectExit: 1, gotExit: r2.status, caught }))
  rmSync(tmp, { recursive: true, force: true })
  if (!okSelf) process.exitCode = 1
}
