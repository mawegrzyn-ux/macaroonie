// src/server.js  (replace existing)
// Adds: WS server attachment after HTTP listen.

import { buildApp }                          from './app.js'
import { sql, systemSql }                    from './config/db.js'
import { env }                               from './config/env.js'
import { attachWss }                         from './config/ws.js'
import { startNotificationWorker,
         startHoldSweepWorker,
         startGloriaFoodPollWorker,
         startAiCleanupWorker }              from './jobs/queues.js'
import { startReviewScrapeWorker }           from './jobs/reviewScrapeWorker.js'
import { startPublishWorker }                from './jobs/publishWorker.js'
import jwksClient                            from 'jwks-rsa'
import { checkVault, sealStoredSecrets }     from './services/vault.js'

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
const notifWorker   = startNotificationWorker(app.log)
const sweepWorker   = startHoldSweepWorker(systemSql, app.log)
const reviewWorker  = startReviewScrapeWorker(app.log)
const publishWorker = startPublishWorker(app.log)
const gfWorker      = startGloriaFoodPollWorker(app.log)
const aiWorker      = startAiCleanupWorker(app.log)

// ── Graceful shutdown ────────────────────────────────────────
const shutdown = async (signal) => {
  app.log.info({ signal }, 'Shutting down')
  await app.close()
  await notifWorker.close()
  await sweepWorker.close()
  await reviewWorker.close()
  await publishWorker.close()
  await gfWorker.close()
  await aiWorker.close()
  await sql.end()
  await systemSql.end()
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

  // Menus made before menu publishing get their first release (migration 165).
  const { backfillFirstReleases } = await import('./services/menuReleases.js')
  backfillFirstReleases(app.log).catch(err => app.log.warn({ err }, 'First menu releases failed'))

  // Keys saved before migration 179 are sealed now.
  sealStoredSecrets()
    .then(n => { if (n) app.log.info(`Sealed ${n} stored integration key(s)`) })
    .catch(err => app.log.warn({ err }, 'Sealing stored keys failed'))

} catch (err) {
  app.log.error(err)
  process.exit(1)
}
