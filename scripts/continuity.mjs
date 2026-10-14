#!/usr/bin/env node
import { readContinuity } from '../core/continuity.js'

const argv = process.argv.slice(2)
const opts = { config: process.env.WHALE_PERSONA_CONFIG || process.env.DSH_WHALE_CONFIG, cwd: process.cwd() }
let command = 'context'
try {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (['context', 'status', 'search', 'read'].includes(arg) && i === 0) command = arg
    else if (['--config', '--cwd', '--model', '--context', '--query', '--limit', '--id'].includes(arg)) {
      if (argv[i + 1] === undefined) throw new Error('missing_value:' + arg)
      opts[arg.slice(2)] = argv[++i]
    } else throw new Error('unknown_argument:' + arg)
  }
  const result = readContinuity(opts)
  if (command === 'context') {
    console.log(JSON.stringify({ status: result.status, configHash: result.configHash, warnings: result.warnings }))
    console.log(result.text)
  } else if (command === 'status') {
    const { text, memories, index, ...status } = result
    console.log(JSON.stringify(status, null, 2))
  } else if (command === 'search') {
    if (!opts.query) throw new Error('query_required')
    console.log(JSON.stringify({ memories: result.memories, excluded: result.excluded }, null, 2))
  } else {
    if (!opts.id) throw new Error('id_required')
    const row = result.memories.find((r) => r.id === opts.id) || readContinuity({ ...opts, query: '', limit: 50 }).memories.find((r) => r.id === opts.id)
    if (!row) {
      // Cold memories stay out of the initial context; requesting their full text is explicit.
      const { readMemory } = await import('../adapters/codex/context.js')
      console.log(JSON.stringify(readMemory(opts, opts.id), null, 2))
    } else console.log(JSON.stringify(row, null, 2))
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'unavailable', error: error.code || error.message }))
  process.exitCode = 1
}
