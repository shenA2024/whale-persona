/**
 * 把仓库根 core/ 同步进 adapters/zcode/vendor/core/。
 *
 * 为什么需要 vendor：ZCode 插件安装单位是「一个自包含目录」，装走后仓库根不一定还在，
 * hook 脚本只能 import 插件目录内的文件。所以 ZCode 适配器内放 core 的副本，
 * 本脚本保证副本与源一致——改 core 后必须跑：node scripts/sync-core.mjs
 * （tests/zcode-hook.mjs 会校验一致性，忘了同步测试会红。）
 */
import { cpSync, rmSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const src = path.join(root, 'core')
const dst = path.join(root, 'adapters', 'zcode', 'vendor', 'core')

rmSync(dst, { recursive: true, force: true })
cpSync(src, dst, { recursive: true })

const files = readdirSync(dst)
console.log('synced core ->', path.relative(root, dst), ':', files.join(', '))
