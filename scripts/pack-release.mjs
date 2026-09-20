#!/usr/bin/env node
/**
 * 打 Release 附件（0.14.2 新增）—— 用 **git worktree** 而不是 `git archive | tar -x`。
 *
 * 为什么：2026-09-21 给 v0.14.2 打附件时发现 `docs/维护状态.md` 没进包 —— Windows 的 tar 解
 * 中文文件名报 "Invalid empty pathname"，解出来的树里少了那个文件，npm pack 自然打不进去
 * （而 `npm pack --dry-run` 在工作树里看是好的，所以肉眼验不出来）。worktree 是真检出，不受这个坑影响。
 *
 * 除了换打法，它还**顺手当门禁**（这才是本条的意义）：
 *   ① 包里的 package.json 版本必须等于 tag；
 *   ② package.json 的 `files` 白名单里每个目录/文件都必须在包里出现（"声明了却打不进"当场红）；
 *   ③ `cordis.patch.yml` 必须在包里（安装契约，发布清单第 2 节那条最容易漏的）；
 *   ④ 打印字节数 + sha256（发布清单要求记下来）。
 *
 * 用法：node scripts/pack-release.mjs v0.14.2 [--out <目录>]
 * 退出码非 0 = 包不合格，别发。
 */
import { execFileSync, execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const argv = process.argv.slice(2)
const tag = argv.find((a) => !a.startsWith('--'))
const outIdx = argv.indexOf('--out')
const outDir = outIdx >= 0 && argv[outIdx + 1] ? path.resolve(argv[outIdx + 1]) : path.join(ROOT, 'data', 'backup', 'release')
if (!tag) { console.error('用法：node scripts/pack-release.mjs <tag> [--out <目录>]'); process.exit(2) }

const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8' })
/**
 * npm 要在 Windows 上经 cmd.exe 调：Node ≥ 20 出于安全默认拒绝直接 spawn `.cmd`（EINVAL），
 * 而 `npm.cmd` 就是这种情况。绕法只有两条 —— shell:true 或显式走 cmd.exe；这里选后者（不经 shell 解析参数）。
 */
const npmPack = (dir, dest) => {
  const line = 'npm pack --silent --pack-destination "' + dest + '"'
  // Windows 上必须经 shell（Node ≥20 拒绝直接 spawn .cmd，手工拼 cmd.exe 的参数转义又很脆），
  // 参数里只有我们自己控的两个路径，且都加了引号 —— 不用 execFileSync 是因为它在这里反而更不可靠。
  return execSync(line, { cwd: dir, encoding: 'utf8' })
}
const fail = (msg) => { console.error('✗ ' + msg); process.exit(1) }

if (!sh('git', ['-C', ROOT, 'tag', '--list', tag]).trim()) fail('没有这个 tag：' + tag)
const wt = path.join(ROOT, 'data', 'backup', 'pack-' + tag)
rmSync(wt, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
sh('git', ['-C', ROOT, 'worktree', 'add', '--detach', '--quiet', wt, tag])
try {
  const pkg = JSON.parse(readFileSync(path.join(wt, 'package.json'), 'utf8'))
  const want = tag.replace(/^v/, '')
  if (pkg.version !== want) fail('包版本 ' + pkg.version + ' ≠ tag ' + tag)

  const name = (npmPack(wt, outDir).trim().split(/\r?\n/).pop() || '')
  const tgz = path.join(outDir, name)
  if (!existsSync(tgz)) fail('npm pack 没产出文件')

  const listing = sh('tar', ['-tzf', tgz]).split(/\r?\n/).filter(Boolean)
  const entries = new Set(listing)
  const has = (p) => entries.has(p) || listing.some((l) => l.startsWith(p))

  for (const f of pkg.files || []) {
    if (!has('package/' + f.replace(/^\.\//, ''))) fail('files 白名单里的 ' + f + ' 没打进包（声明了却打不进 = 等于没声明）')
  }
  if (!has('package/cordis.patch.yml')) fail('包里没有 cordis.patch.yml（安装契约）')

  const bytes = statSync(tgz).size
  const sha = createHash('sha256').update(readFileSync(tgz)).digest('hex')
  console.log('✓ ' + name)
  console.log('  条目 ' + listing.length + ' | ' + bytes + ' bytes | sha256=' + sha)
  console.log('  files 白名单全部在包里：' + (pkg.files || []).join(', '))
} finally {
  sh('git', ['-C', ROOT, 'worktree', 'remove', '--force', wt])
  rmSync(wt, { recursive: true, force: true })
}
