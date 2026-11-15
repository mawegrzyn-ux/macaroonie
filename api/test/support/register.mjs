// Loaded with node --import before the tests (see package.json "test"):
// swaps the Auth0 login check for the test one (auth-stub.mjs), and keeps
// the API's log quiet unless LOG_LEVEL is set (LOG_LEVEL=info npm test),
// and keeps the report files the tests make out of the server's folder.
import { register } from 'node:module'
import os from 'node:os'
import path from 'node:path'

process.env.LOG_LEVEL ||= 'silent'
// Report files the tests keep (services/privateStore.js) go to a folder of their own.
process.env.PRIVATE_DIR ||= path.join(os.tmpdir(), 'macaroonie-private-test')
register('./loader.mjs', import.meta.url)
