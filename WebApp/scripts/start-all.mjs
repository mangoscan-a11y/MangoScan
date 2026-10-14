/**
 * Starts the whole machine software with one command and stops it with Ctrl+C:
 *   1. the Python inference service (Model 5 fusion plus the models)
 *   2. the MangoScan server (MongoDB, ESP32 serial, dashboard)
 *
 *   npm run machine                     real ESP32 boards, SIMULATED models
 *   npm run machine:mock                simulated boards and simulated models (no hardware)
 *   npm run machine -- --models=my_mod  use your own models module instead of the simulated ones
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fusionDir = path.resolve(root, '../MyTasks/model5_fusion')
const args = process.argv.slice(2)
const mockHardware = args.includes('--mock-hardware')
const modelsArg = args.find((a) => a.startsWith('--models='))
const modelsModule = modelsArg ? modelsArg.split('=')[1] : null
if (modelsModule !== null && !/^[A-Za-z_][\w.]*$/.test(modelsModule)) {
  console.error('--models must be a Python module name such as my_models')
  process.exit(1)
}

const port = process.env.PORT ?? '4000'
const storage = path.resolve(root, process.env.STORAGE_DIR ?? 'storage')
const children = []
let stopping = false

function stopAll(code) {
  if (stopping) return
  stopping = true
  for (const c of children) c.kill()
  setTimeout(() => process.exit(code), 400)
}

function findPython() {
  for (const cmd of [['python'], ['py', '-3']]) {
    const probe = spawnSync(cmd[0], [...cmd.slice(1), '--version'], { encoding: 'utf8' })
    if (probe.status === 0) return cmd
  }
  return null
}

function launch(name, command, commandArgs, options) {
  const child = spawn(command, commandArgs, { stdio: 'inherit', windowsHide: true, ...options })
  child.on('exit', (code) => {
    if (!stopping) {
      console.error('\n[' + name + '] stopped unexpectedly (exit ' + code + '). Shutting everything down.')
      stopAll(1)
    }
  })
  child.on('error', (err) => {
    console.error('[' + name + '] could not start: ' + err.message)
    stopAll(1)
  })
  children.push(child)
  return child
}

if (fs.existsSync(path.join(fusionDir, 'fusion', 'service.py'))) {
  const python = findPython()
  if (!python) {
    console.error('Python was not found on PATH, so the models service cannot start.')
    process.exit(1)
  }
  const pyArgs = ['-u', '-m', 'fusion.service', '--images-root', storage]
  if (modelsModule) pyArgs.push('--models', modelsModule)
  else pyArgs.push('--mock')
  if (!modelsModule) console.log('NOTE: models are SIMULATED. Classifications are made up until real models are connected.\n')
  launch('models', python[0], [...python.slice(1), ...pyArgs], { cwd: fusionDir })
} else {
  console.warn('MyTasks/model5_fusion was not found, starting the server without the models service.')
}

const tsxCli = createRequire(import.meta.url).resolve('tsx/cli')
const serverArgs = [tsxCli, 'server/index.ts']
if (mockHardware) serverArgs.push('--mock')
setTimeout(() => {
  if (!stopping) launch('server', process.execPath, serverArgs, { cwd: root, env: { ...process.env, PORT: port } })
}, 600)

process.on('SIGINT', () => stopAll(0))
process.on('SIGTERM', () => stopAll(0))
