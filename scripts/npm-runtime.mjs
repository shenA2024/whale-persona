/** Packaging-only helper; npm supplies its own tar library (not a runtime dependency). */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

export function npmCli() {
  if (process.env.npm_execpath && existsSync(process.env.npm_execpath)) return process.env.npm_execpath
  const cli = [
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(process.execPath), 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].find((p) => existsSync(p))
  if (!cli) throw new Error('npm_cli_unavailable')
  return cli
}
export function npmTar() { return createRequire(npmCli())('tar') }
