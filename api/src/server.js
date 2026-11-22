// src/server.js  (replace existing)
// Adds: WS server attachment after HTTP listen.

import { buildApp }                          from './app.js'
import { sql, systemSql, reportSql }         from './config/db.js'
import { env }                               from './config/env.js'
import { attachWss }                         from './config/ws.js'
import { loadJobs }                          from './jobs/queues.js'
import jwksClient                            from 'jwks-rsa'
import { checkVault, sealStoredSecrets }     from './services/vault.js'
import { startProcessBeat, watchWorker }     from './services/platformStatus.js'
import { startPlatformAlerts }               from './services/platformAlerts.js'

// Stored integration keys are sealed with SECRETS_KEY (migration 179): in
// production the API doesn't start without a valid one.
try {
  checkVault()
} catch (err) {
  console.error('✗ ' + err.message + '. The deploy adds it to api/.env (scripts/ensure-secrets-key.sh).')
  process.exit(1)
}

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
// One file per job in src/jobs (loadJobs(), jobs/queues.js): each starts its
// worker and, for a repeating job, its repeat. `app` is for the jobs that run
// routes (task notices).
const workers = (await loadJobs()).map(job => [job.name, job.start(app.log, { app })])
// When each background job last finished or failed, for the Platform page's Status.
for (const [name, w] of workers) watchWorker(name, w)
let stopBeat = null
let stopAlerts = null

// ── Graceful shutdown ────────────────────────────────────────
const shutdown = async (signal) => {
  app.log.info({ signal }, 'Shutting down')
  stopBeat?.()
  stopAlerts?.()
  await app.close()
  for (const [, w] of workers) await w.close()
  await sql.end()
  await systemSql.end()
  await reportSql.end()
  process.exit(0)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))

// ── Start ────────────────────────────────────────────────────
try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' })
  app.log.info(`API listening on :${env.PORT}`)
  stopBeat = startProcessBeat(app.log)
  // Emails platform admins when the platform turns red (one process of the cluster).
  stopAlerts = startPlatformAlerts(app.log)

  // Attach WS server to the same HTTP server
  attachWss(app.server, verifyWsToken)
  app.log.info('WebSocket server attached at /ws')

  // Menus made before menu publishing get their first release (migration 165).
  const { backfillFirstReleases } = await import('./services/menuReleases.js')
  backfillFirstReleases(app.log).catch(err => app.log.warn({ err }, 'First menu releases failed'))
  // Checks stored before the report builder get the breakdowns reports read
  // (migration 243). Not awaited: the till works without them.
  const { backfillCheckProjections } = await import('./services/posSvc.js')
  backfillCheckProjections(app.log).catch(err => app.log.warn({ err }, 'Till check breakdowns failed'))
  // Supplier orders sent before migration 247 are judged on time or late.
  const { backfillSentLate } = await import('./services/purchasingSvc.js')
  backfillSentLate(app.log).catch(err => app.log.warn({ err }, 'Judging supplier orders sent late failed'))

  // Keys saved before migration 179 are sealed now.
  sealStoredSecrets()
    .then(n => { if (n) app.log.info(`Sealed ${n} stored integration key(s)`) })
    .catch(err => app.log.warn({ err }, 'Sealing stored keys failed'))

} catch (err) {
  app.log.error(err)
  process.exit(1)
}
