/** Local visual-design preview only. Never use this command for production hosting. */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const nextCli = require.resolve('next/dist/bin/next')
const child = spawn(process.execPath, [nextCli, 'dev', '--hostname', '127.0.0.1', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'development', LOCAL_DESIGN_MODE: 'true' },
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', code => { process.exitCode = code ?? 1 })
child.on('error', error => { console.error('Cannot launch Next.js design preview:', error.message); process.exitCode = 1 })
