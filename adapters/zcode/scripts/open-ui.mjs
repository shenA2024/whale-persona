#!/usr/bin/env node
/**
 * 打开 whale-persona 的本地配置编辑页 —— **配置启动器**（跨平台、零依赖）。
 *
 * 为什么有它（2026-10-16）：ZCode 侧没有 DSH 那种内嵌设置面板（那个面板是 DSH 宿主专属的
 * client 半身，ZCode 的插件机制不给往宿主 UI 插页面的口子）。但"改人设"这件事两边共用
 * **同一份 config** 与**同一个本地页**（`scripts/ui.mjs` → `http://127.0.0.1:8787`）。
 * 所以这一侧给一个启动器就够了：探端口 → 复用已在跑的实例（只认 `/api/state` 报的 file
 * 与我们这份 config 一致）→ 没有就隐藏起一个 → 打开浏览器。
 *
 * **它不注入任何人设**：只把编辑页打开；编哪份配置由 `--config` / `WHALE_PERSONA_CONFIG` /
 * 定位链决定（默认就是 DSH 与 ZCode 共用的那一份）。所以它跟 hook 是两件事：
 * hook 会往会话里注入文本，这个只开界面。
 *
 * 用法：
 *   node scripts/open-ui.mjs                          # 起始端口 8787
 *   node scripts/open-ui.mjs --port 9000 --print      # 只打印 url，不开浏览器
 *   node scripts/open-ui.mjs --engine <目录> --config <config.json>
 *
 * `--engine` 缺省按 `$WHALE_PERSONA_ENGINE` → `~/.dsh/plugins/whale-persona` 找
 * （DSH 插件装好后那份实体副本里就带 `scripts/ui.mjs`）。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const argv = process.argv.slice(2)
const argOf = (name, def = '') => {
  const i = argv.indexOf('--' + name)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def
}

const startPort = Number(argOf('port', '8787')) || 8787
const home = process.env.USERPROFILE || os.homedir()
const engine = path.resolve(argOf('engine', process.env.WHALE_PERSONA_ENGINE || path.join(home, '.dsh', 'plugins', 'whale-persona')))
const uiScript = path.join(engine, 'scripts', 'ui.mjs')
const config = argOf('config', process.env.WHALE_PERSONA_CONFIG || '')

if (!existsSync(uiScript)) {
  console.error('找不到本地编辑页：' + uiScript)
  console.error('用 --engine <whale-persona 目录> 指到装好这份插件的位置（它里面有 scripts/ui.mjs）。')
  process.exit(2)
}

const sameFile = (a, b) => {
  try { return path.resolve(String(a)).toLowerCase() === path.resolve(String(b)).toLowerCase() } catch { return false }
}

async function probe(port) {
  try {
    const res = await fetch('http://127.0.0.1:' + port + '/api/state', { signal: AbortSignal.timeout(800) })
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

function openBrowser(url) {
  const platform = process.platform
  const cmd = platform === 'win32' ? 'cmd' : platform === 'darwin' ? 'open' : 'xdg-open'
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try { spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref() } catch { /* 打不开就算了，url 已经打印出来 */ }
}

let uiPort = null
let started = false
let serverPid = null

// ① 复用已在跑的实例（但必须服务的是同一份配置，否则会看着别人的配置改半天）
for (let p = startPort; p < startPort + 10; p++) {
  const st = await probe(p)
  if (st && st.ok && (!config || sameFile(st.file, config))) { uiPort = p; break }
}

// ② 起一个（逐个端口试，被占就换下一个；起不来就算这次失败）
if (uiPort === null) {
  for (let p = startPort; p < startPort + 10; p++) {
    if (await probe(p)) continue
    const child = spawn(process.execPath, [uiScript, '--port', String(p)], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: config ? { ...process.env, WHALE_PERSONA_CONFIG: config } : process.env,
    })
    child.unref()
    let ready = false
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 200))
      const st = await probe(p)
      if (st && st.ok && (!config || sameFile(st.file, config))) { ready = true; break }
    }
    if (ready) { uiPort = p; started = true; serverPid = child.pid; break }
    try { process.kill(child.pid) } catch { /* 已经退了 */ }
  }
}

if (uiPort === null) {
  console.error('没能在 ' + startPort + '–' + (startPort + 9) + ' 里开出编辑页（端口被占或 ui.mjs 起不来）。')
  process.exit(1)
}

const url = 'http://127.0.0.1:' + uiPort
if (!argv.includes('--print')) openBrowser(url)
console.log(JSON.stringify({ url, started, serverPid, engine, config: config || '(定位链默认)' }))
