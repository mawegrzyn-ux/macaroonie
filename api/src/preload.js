// preload.js — loaded via --import before any app module is evaluated.
// Sets process.env from .env file so env.js Zod validation always passes.
import { existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath   = resolve(__dirname, '../.env')   // api/src → api/.env

if (existsSync(envPath)) {
  process.loadEnvFile(envPath)
} else {
  // fallback: try repo root (local dev)
  const rootEnv = resolve(__dirname, '../../.env')
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv)
}
