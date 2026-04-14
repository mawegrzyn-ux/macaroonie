// src/services/storageSvc.js
//
// Pluggable file storage for the website CMS.
//   STORAGE_DRIVER=local  → writes to env.UPLOAD_DIR, served by @fastify/static
//   STORAGE_DRIVER=s3     → writes to S3-compatible bucket (AWS S3, DO Spaces, …)
//
// Every driver implements:
//   put(tenantId, kind, ext, mimetype, buffer) → { url, bytes, key }
//   delete(url)                                → void
//
// Returned `url` is what's stored in the DB. For `local` it's a relative
// path like `/uploads/{tenant}/{kind}/{uuid}.{ext}`; for `s3` it's an
// absolute URL built from S3_PUBLIC_URL_BASE.

import fs     from 'node:fs/promises'
import path   from 'node:path'
import crypto from 'node:crypto'
import { env } from '../config/env.js'

// ── Local filesystem driver ─────────────────────────────────

class LocalStorage {
  constructor({ baseDir }) {
    this.baseDir = baseDir
  }

  async put(tenantId, kind, ext, mimetype, buffer) {
    const id  = crypto.randomUUID()
    const dir = path.join(this.baseDir, tenantId, kind)
    await fs.mkdir(dir, { recursive: true })
    const filename = `${id}.${ext}`
    await fs.writeFile(path.join(dir, filename), buffer)
    return {
      url:   `/uploads/${tenantId}/${kind}/${filename}`,
      bytes: buffer.length,
      key:   `${tenantId}/${kind}/${filename}`,
    }
  }

  async delete(url) {
    // Expected shape: /uploads/<rest>
    if (!url?.startsWith('/uploads/')) return
    const rel = url.slice('/uploads/'.length)
    const abs = path.join(this.baseDir, rel)
    // Guard against path traversal — resolved path must stay under baseDir.
    const safe = path.resolve(abs)
    if (!safe.startsWith(path.resolve(this.baseDir) + path.sep)) return
    await fs.rm(safe, { force: true }).catch(() => {})
  }
}

// ── S3 / S3-compatible driver ───────────────────────────────
// Lazy-imports @aws-sdk/client-s3 so the dependency is only loaded when
// STORAGE_DRIVER=s3. This keeps `npm install` lean for local-storage
// deployments that don't need the AWS SDK at runtime.

class S3Storage {
  constructor({ bucket, region, endpoint, accessKeyId, secretAccessKey, publicUrlBase, forcePathStyle }) {
    this.bucket         = bucket
    this.region         = region
    this.endpoint       = endpoint
    this.publicUrlBase  = publicUrlBase
    this.forcePathStyle = forcePathStyle
    this.accessKeyId     = accessKeyId
    this.secretAccessKey = secretAccessKey
    this._client         = null
  }

  async _getClient() {
    if (this._client) return this._client
    const { S3Client } = await import('@aws-sdk/client-s3')
    this._client = new S3Client({
      region:     this.region,
      endpoint:   this.endpoint || undefined,
      forcePathStyle: !!this.forcePathStyle,
      credentials: (this.accessKeyId && this.secretAccessKey) ? {
        accessKeyId:     this.accessKeyId,
        secretAccessKey: this.secretAccessKey,
      } : undefined,
    })
    return this._client
  }

  _urlFor(key) {
    // publicUrlBase is something like `https://cdn.macaroonie.com` or the
    // default bucket URL `https://<bucket>.s3.<region>.amazonaws.com`.
    const base = this.publicUrlBase.replace(/\/$/, '')
    return `${base}/${key}`
  }

  async put(tenantId, kind, ext, mimetype, buffer) {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3')
    const client = await this._getClient()
    const id     = crypto.randomUUID()
    const key    = `${tenantId}/${kind}/${id}.${ext}`
    await client.send(new PutObjectCommand({
      Bucket:      this.bucket,
      Key:         key,
      Body:        buffer,
      ContentType: mimetype,
      ACL:         'public-read',
      CacheControl: 'public, max-age=2592000', // 30d
    }))
    return {
      url:   this._urlFor(key),
      bytes: buffer.length,
      key,
    }
  }

  async delete(url) {
    if (!this.publicUrlBase) return
    const base = this.publicUrlBase.replace(/\/$/, '')
    if (!url?.startsWith(base + '/')) return
    const key  = url.slice(base.length + 1)
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3')
    const client = await this._getClient()
    await client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })).catch(() => {})
  }
}

// ── Factory ─────────────────────────────────────────────────

let _storage = null

export function getStorage() {
  if (_storage) return _storage
  if (env.STORAGE_DRIVER === 's3') {
    if (!env.S3_BUCKET || !env.S3_REGION || !env.S3_PUBLIC_URL_BASE) {
      throw new Error('STORAGE_DRIVER=s3 requires S3_BUCKET, S3_REGION, and S3_PUBLIC_URL_BASE')
    }
    _storage = new S3Storage({
      bucket:          env.S3_BUCKET,
      region:          env.S3_REGION,
      endpoint:        env.S3_ENDPOINT,
      accessKeyId:     env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      publicUrlBase:   env.S3_PUBLIC_URL_BASE,
      forcePathStyle:  env.S3_FORCE_PATH_STYLE,
    })
  } else {
    _storage = new LocalStorage({ baseDir: env.UPLOAD_DIR })
  }
  return _storage
}
