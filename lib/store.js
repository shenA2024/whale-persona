/**
 * 配置存储：$DSH_HOME/whale-suite/config.json
 *
 * 读法带 mtime 缓存 —— 每次组装提示词都会调 get()，但不至于每步都读盘。
 * 文件被 UI 或手工改动后，下一步组装即生效（不需要新会话，也不缓存穿透）。
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DEFAULTS, mergeConfig } from './defaults.js'

export function configDir() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'whale-suite')
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
      // 文件不存在 / 坏 JSON / 读不动：回落到默认值，绝不让提示词装配抛错
      if (cache === null) cache = mergeConfig(null)
    }
    return cache
  }

  /** 首次运行落一份默认配置，方便用户直接改 */
  function ensureFile() {
    try {
      statSync(file)
    } catch {
      try {
        mkdirSync(path.dirname(file), { recursive: true })
        writeFileSync(file, JSON.stringify(DEFAULTS, null, 2), 'utf8')
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
