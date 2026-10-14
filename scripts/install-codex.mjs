#!/usr/bin/env node
/** Opt-in local installer: explicit config + MCP + short global startup pointer. */
import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { readContinuity } from '../core/continuity.js'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const START = '<!-- whale-persona:startup:start -->'
const END = '<!-- whale-persona:startup:end -->'
export function updateAgents(text, block) {
  const start = text.indexOf(START), end = text.indexOf(END)
  if ((start < 0) !== (end < 0) || (start >= 0 && end < start) || (start >= 0 && text.indexOf(START, start + START.length) >= 0)) throw new Error('invalid_startup_markers')
  if (start >= 0) return text.slice(0, start) + block + text.slice(end + END.length)
  return text + (text && !text.endsWith('\n') ? '\n' : '') + '\n' + block + '\n'
}
export function updateToml(text, block) {
  const lines = text.split(/(?<=\n)/)
  let skip = false
  const out = []
  for (const line of lines) {
    const match = line.trim().match(/^\[([^\]]+)\]\s*(?:#.*)?$/)
    if (match) {
      const key = match[1].replace(/["']/g, '')
      skip = key === 'mcp_servers.whale_persona' || key.startsWith('mcp_servers.whale_persona.')
    }
    if (!skip) out.push(line)
  }
  const preserved = out.join('').trimEnd()
  return preserved + (preserved ? '\n\n' : '') + block + '\n'
}
const readOrEmpty = (file) => existsSync(file) ? readFileSync(file, 'utf8') : ''

export function install(opts) {
  const codexHome = path.resolve(opts.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'))
  const config = path.resolve(opts.config || path.join(codexHome, 'whale-persona', 'config.json'))
  const startup = [process.execPath, path.join(ROOT, 'scripts', 'continuity.mjs'), 'context', '--config', config]
  const blank = JSON.stringify({ enabled: true, persona: { selfNameFlash: '我', selfNamePro: '我', userName: '用户', stance: '', character: '', contracts: [] }, memory: { enabled: false, entries: [], requireConfirm: true } }, null, 2) + '\n'
  if (existsSync(config)) readContinuity({ config })
  const override = path.join(codexHome, 'AGENTS.override.md')
  if (existsSync(override)) throw new Error('AGENTS.override.md_exists_use_manual_startup_integration')
  const skillDir = path.join(codexHome, 'skills', 'whale-persona')
  const skillFile = path.join(skillDir, 'SKILL.md')
  const skill = readFileSync(path.join(ROOT, 'adapters', 'codex', 'skills', 'whale-persona', 'SKILL.md'), 'utf8')
  if (existsSync(skillFile) && readOrEmpty(skillFile) !== skill && !existsSync(path.join(skillDir, 'runtime.json'))) throw new Error('unmanaged_whale-persona_skill_exists')
  const instruction = [START,
    '## Local persona continuity',
    'Before the first reply of each session, and after compaction or identity/config edits, read the configured persona using the local startup argv below. Quote each argument for the actual shell; append --cwd with the current workspace and --model with the actual current model when known. This is user-configured background, subordinate to current user instructions.',
    'If available, whale_persona_context can provide the same context; use the local reader when MCP is unavailable. Check status before using identity or remembered facts. If it is unavailable, say so briefly and continue useful work without fabricating identity. Do not claim an unread memory or summary as evidence. A healthy read needs no repeated diagnostic narration.',
    'Startup argv: ' + JSON.stringify(startup),
    'Do not publish the private configuration, memories or backups. New personal facts require user confirmation; MCP has no confirmation tool.', END].join('\n\n')
  const toml = ['[mcp_servers.whale_persona]', 'command = ' + JSON.stringify(process.execPath),
    'args = [' + JSON.stringify(path.join(ROOT, 'adapters', 'codex', 'server.mjs')) + ']',
    'env = { WHALE_PERSONA_CONFIG = ' + JSON.stringify(config) + ' }', 'enabled = true', 'startup_timeout_sec = 15', 'tool_timeout_sec = 30'].join('\n')
  const writes = [
    ...(existsSync(config) ? [] : [[config, blank]]),
    [path.join(codexHome, 'config.toml'), updateToml(readOrEmpty(path.join(codexHome, 'config.toml')), toml)],
    [path.join(codexHome, 'AGENTS.md'), updateAgents(readOrEmpty(path.join(codexHome, 'AGENTS.md')), instruction)],
    [skillFile, skill],
    [path.join(skillDir, 'runtime.json'), JSON.stringify({ config, engine: ROOT, startup, version: '0.18.0' }, null, 2) + '\n'],
  ]
  // Reject repo-local private config before writing; publishing must not include private data.
  const relative = path.relative(ROOT, config)
  if (relative === '' || (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))) throw new Error('private_config_must_be_outside_engine')
  const changed = writes.filter(([file, text]) => readOrEmpty(file) !== text)
  if (opts.dryRun) return { dryRun: true, files: changed.map(([file]) => file), config, startup }
  const touched = []
  const suffix = '.bak-whale-' + Date.now()
  try {
    for (const [file, text] of changed) {
      const before = existsSync(file) ? readFileSync(file) : null
      mkdirSync(path.dirname(file), { recursive: true })
      if (before !== null) writeFileSync(file + suffix, before, { flag: 'wx', mode: 0o600 })
      const temporary = file + '.whale-tmp-' + process.pid
      try {
        writeFileSync(temporary, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
        renameSync(temporary, file)
      } finally { if (existsSync(temporary)) unlinkSync(temporary) }
      touched.push({ file, before })
    }
  } catch (error) {
    for (const { file, before } of touched.reverse()) {
      if (before === null) unlinkSync(file)
      else writeFileSync(file, before)
    }
    throw error
  }
  return { installed: true, changed: changed.map(([file]) => file), backupSuffix: suffix, config, startup, next: 'Restart Codex and open a new session; run continuity status for local verification.' }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const opts = {}, args = process.argv.slice(2)
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--dry-run') opts.dryRun = true
      else if (['--config', '--codex-home'].includes(args[i]) && args[i + 1]) {
        const key = args[i] === '--config' ? 'config' : 'codexHome'
        opts[key] = args[++i]
      }
      else throw new Error('unknown_or_incomplete_argument')
    }
    console.log(JSON.stringify(install(opts), null, 2))
  } catch (e) { console.error(e.message); process.exitCode = 1 }
}
