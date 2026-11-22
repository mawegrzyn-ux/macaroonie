// src/jobs/connection.js
//
// What every queue and worker shares: the Redis connection and the key
// prefix (QUEUE_PREFIX), so a run with its own prefix never sees another's
// jobs. Not a job itself: loadJobs() (jobs/queues.js) skips it.

import { env } from '../config/env.js'

export const connection = { url: env.REDIS_URL }
export const prefix = env.QUEUE_PREFIX
