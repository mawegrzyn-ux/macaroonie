// src/server.js  (replace existing)
// Adds: WS server attachment after HTTP listen.

// Load .env before anything else — works in both PM2 cluster and direct node.
// process.loadEnvFile() is Node 22 built-in (no dotenv dependency needed).
import { existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath   = resolve(__dirname, '../../.env')
if (existsSync(envPath)) process.loadEnvFile(envPath)

import { buildApp }                          from './app.js'
import { sql }                               from './config/db.js'
import { env }                               from './config/env.js'
import { attachWss }                         from './config/ws.js'
import { startNotificationWorker,
         startHoldSweepWorker }              from './jobs/queues.js'
import jwksClient                            from 'jwks-rsa'

const app = await buildApp()

// ── JWKS verifier for WS auth ────────────────────────────────
const jwks = jwksClient({
  jwksUri: `https://${env.AUTH0_DOMAIN}/.well-known/jwks.json`,
  cache: true,
})

async function verifyWsToken(token) {
  // Re-use fastify/jwt verify for simplicity
  return app.jwt.verify(token)
}

// ── Background workers ───────────────────────────────────────
const notifWorker = startNotificationWorker(app.log)
const sweepWorker = startHoldSweepWorker(sql, app.log)

// ── Graceful shutdown ────────────────────────────────────────
const shutdown = async (signal) => {
  app.log.info({ signal }, 'Shutting down')
  await app.close()
  await notifWorker.close()
  await sweepWorker.close()
  await sql.end()
  process.exit(0)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))

// ── Start ────────────────────────────────────────────────────
try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' })
  app.log.info(`API listening on :${env.PORT}`)

  // Attach WS server to the same HTTP server
  attachWss(app.server, verifyWsToken)
  app.log.info('WebSocket server attached at /ws')

} catch (err) {
  app.log.error(err)
  process.exit(1)
}
