// Свої Python-скрипти в середовищі самого Hermes (його venv, PYTHONPATH, HERMES_HOME): команду запуску дає
// штатний `hermes --print-runtime-command`, ми лише підставляємо свій скрипт замість його CLI.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { HERMES_AGENT_DIR, HERMES_HOME } from './config.ts'

const LAUNCHER = join(HERMES_AGENT_DIR, '.hermes', 'bin', 'hermes')

let base: Promise<string[]> | null = null

function runtimeCommand(): Promise<string[]> {
  base ??= (async () => {
    if (!existsSync(LAUNCHER)) throw new Error('немає лаунчера Hermes')
    const { stdout } = await promisify(execFile)(LAUNCHER, ['--print-runtime-command'], { timeout: 20_000, env: { ...process.env, HERMES_HOME } })
    const cmd = JSON.parse(stdout) as string[]
    if (!/runpy\.run_module\([^)]*\)/.test(cmd.at(-1) ?? '')) throw new Error('несподівана команда запуску Hermes')
    return cmd
  })().catch((err: unknown) => {
    base = null
    throw err
  })
  return base
}

/** Команда, що виконує script у середовищі Hermes. */
export async function hermesScript(script: string): Promise<string[]> {
  const cmd = await runtimeCommand()
  const code = cmd.at(-1)!.replace(/runpy\.run_module\([^)]*\)/, `runpy.run_path(${JSON.stringify(script)}, run_name='__main__')`)
  return [...cmd.slice(0, -1), code]
}

export const hermesEnv = () => ({ ...process.env, HERMES_HOME })
