// Loaded with node --import before the tests (see package.json "test"):
// swaps the Auth0 login check for the test one (auth-stub.mjs), and keeps
// the API's log quiet unless LOG_LEVEL is set (LOG_LEVEL=info npm test).
import { register } from 'node:module'

process.env.LOG_LEVEL ||= 'silent'
register('./loader.mjs', import.meta.url)
