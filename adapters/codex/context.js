import { readFileSync } from 'node:fs'
import path from 'node:path'
import { readContinuity, memoryId } from '../../core/continuity.js'
import { replayInbox, kindOf, STATUS } from '../../core/memoryInbox.js'
import { applicability } from '../../core/memoryEvidence.js'

export function readMemory(opts, id) {
  // Validate the configured root and reload current confirmation/applicability first.
  const result = readContinuity(opts)
  const existing = result.memories.find((r) => r.id === id)
  if (existing) return existing
  if (!/^inbox:[a-f0-9]{64}$/.test(id)) throw new Error('memory_not_available')
  const cfg = JSON.parse(readFileSync(opts.config, 'utf8').replace(/^\uFEFF/, ''))
  if (cfg.enabled === false || cfg.memory?.enabled !== true || cfg.memory?.inbox === false) throw new Error('memory_not_available')
  const file = cfg.memory?.inboxPath ? path.resolve(path.dirname(opts.config), cfg.memory.inboxPath) : path.join(path.dirname(opts.config), 'memory-inbox.jsonl')
  const entry = replayInbox(readFileSync(file, 'utf8').split(/\r?\n/)).find((e) => memoryId('inbox', e) === id)
  if (!entry || entry.status !== STATUS.confirmed || kindOf(entry) !== 'memory' || applicability(entry, opts).state !== 'ACCEPT') throw new Error('memory_not_available')
  return { id, entry, origin: 'inbox', applicability: applicability(entry, opts) }
}
