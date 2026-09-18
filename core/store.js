/**
 * 配置存储：$DSH_HOME/whale-persona/config.json（默认位置，与插件同名）
 *
 * 旧布局兼容：早期版本把配置放在 $DSH_HOME/whale-suite/；该目录里已有 config.json 时继续沿用
 * （老用户零迁移），否则用新目录。完整定位链见 adapters/zcode/README.md。
 *
 * 读法带 mtime 缓存 —— 每次组装提示词都会调 get()，但不至于每步都读盘。
 * 文件被 UI 或手工改动后，下一步组装即生效（不需要新会话，也不缓存穿透）。
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DEFAULTS, mergeConfig } from './defaults.js'

/** DSH 主目录（环境变量优先），config 与 inbox 都落在它下面 */
export function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

/**
 * 配置目录（收件箱的默认落点也在它下面）：
 *   $DSH_HOME/whale-persona   默认（与插件同名）
 *   $DSH_HOME/whale-suite     旧布局，目录里已有 config.json 时沿用
 */
export function configDir() {
  const home = dshHome()
  const legacy = path.join(home, 'whale-suite')
  try {
    if (statSync(path.join(legacy, 'config.json')).isFile()) return legacy
  } catch { /* 目录/文件不存在：用新布局 */ }
  return path.join(home, 'whale-persona')
}

export function configPath() {
  return process.env.DSH_WHALE_CONFIG || path.join(configDir(), 'config.json')
}

export function createStore() {
  const file = configPath()
  let cache = null
  let stamp = ''

  function get() {
    try {
      const st = statSync(file)
      const key = String(st.mtimeMs) + ':' + String(st.size)
      if (key !== stamp) {
        cache = mergeConfig(JSON.parse(readFileSync(file, 'utf8')))
        stamp = key
      }
    } catch {
      // 文件不存在 / 坏 JSON / 读不动：首次回落默认值，之后沿用上次结果，绝不让提示词装配抛错
      if (cache === null) cache = mergeConfig(null)
    }
    return cache
  }

  /**
   * 首次运行落一份**骨架**配置，方便用户直接改。
   * 只写 persona 段，不写 memory 段——不同加载方的默认可能不同（本仓库 memory 默认关，
   * 外部配置界面可能默认开），落盘写死任何一边都会在另一边静默生效；
   * 骨架不写，各读取方 mergeConfig 时按自己的默认补，谁读谁负责。
   */
  function ensureFile() {
    try {
      statSync(file)
    } catch {
      try {
        mkdirSync(path.dirname(file), { recursive: true })
        const skeleton = { enabled: DEFAULTS.enabled, thinkingLanguage: DEFAULTS.thinkingLanguage, persona: DEFAULTS.persona }
        writeFileSync(file, JSON.stringify(skeleton, null, 2) + '\n', 'utf8')
        stamp = ''
      } catch { /* 写不了就算了，内存默认值照样能用 */ }
    }
  }

  function save(cfg) {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(cfg, null, 2), 'utf8')
    stamp = ''
    return get()
  }

  return { get, save, ensureFile, file }
}
