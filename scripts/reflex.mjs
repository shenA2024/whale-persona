#!/usr/bin/env node
/**
 * 条件反射：一条命令入口（show / check / new）。
 *
 * 为什么把入口收成一个（2026-09-20）：规则是个人资产，**改规则、体检、看台账**是同一件事的三个动作，
 * 三个脚本各记一个名字，用户和 AI 都得背三条命令。这里只做分发，逻辑在 scripts/reflex/ 下的三个脚本里。
 *
 *   node scripts/reflex.mjs show                     # 规则 + 命中台账（含最近一次原话）
 *   node scripts/reflex.mjs check                    # 体检（退出码 0 才算交付）
 *   node scripts/reflex.mjs check --hit '你说的话'   # 试命中：不写档位 = 跨档试
 *   node scripts/reflex.mjs new --id x --tier flash --nearAny '...' --reply '...' --pos '...' --neg '...'
 *                                                    # 建一条：先试算，加 --yes 才写盘（自动备份 + 体检闸门 + 不过回滚）
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const cmd = String(process.argv[2] || '').trim()
const KNOWN = ['show', 'check', 'new']

if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help' || KNOWN.indexOf(cmd) < 0) {
  console.log('用法：node scripts/reflex.mjs <show|check|new> [参数]')
  console.log('  show    看规则与命中台账')
  console.log('  check   体检当前规则文件（--hit <原话> 试命中；--tier flash|pro 只按单档判）')
  console.log('  new     建一条规则（--id/--tier/--text/--nearAny/--keywords/--reply/--directive/--pos/--neg，加 --yes 才写盘）')
  process.exit(cmd ? 2 : 0)
}

const r = spawnSync(process.execPath, [path.join(HERE, 'reflex', cmd + '.mjs')].concat(process.argv.slice(3)), { stdio: 'inherit', shell: false })
process.exit(r.status === null ? 1 : r.status)
