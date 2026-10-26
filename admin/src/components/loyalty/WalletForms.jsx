// src/components/loyalty/WalletForms.jsx
//
// The Apple Wallet and Google Wallet account forms (migration 211): used by
// the Platform page (Macaroonie's accounts, PUT /api/loyalty/platform/wallet/
// :kind) and by Loyalty > Wallet (a tenant's own, PUT /api/loyalty/wallet/
// :kind). The API checks the certificate, key and service account before
// saving and never sends any of them back: the forms always start empty.

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const fieldCls = 'w-full rounded-md border bg-background px-3 min-h-[44px] text-sm touch-manipulation'
const areaCls = 'w-full rounded-md border bg-background px-3 py-2 text-xs font-mono touch-manipulation min-h-[96px]'

/** Reads a file the person picks into the box beside it (a .pem or .json). */
function FileText({ label, value, onChange, accept, placeholder, testId }) {
  return (
    <label className="block space-y-1">
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="relative inline-flex items-center min-h-[36px] px-3 rounded-md border text-xs bg-background touch-manipulation cursor-pointer">
          Choose file
          <input type="file" accept={accept} className="absolute inset-0 opacity-0 cursor-pointer"
            onChange={async e => { const f = e.target.files?.[0]; if (f) onChange(await f.text()); e.target.value = '' }} />
        </span>
      </span>
      <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} spellCheck={false}
        className={areaCls} data-testid={testId} />
    </label>
  )
}

export function AppleWalletForm({ onSave, saving, error, testPrefix = 'wallet-apple' }) {
  const [f, setF] = useState({ pass_type_id: '', team_id: '', cert_pem: '', key_pem: '', wwdr_pem: '' })
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const ready = f.pass_type_id.trim() && f.team_id.trim() && f.cert_pem.trim() && f.key_pem.trim() && f.wwdr_pem.trim()
  return (
    <form className="space-y-3" autoComplete="off" onSubmit={e => { e.preventDefault(); if (ready) onSave(f) }}>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Pass Type ID</span>
          <input value={f.pass_type_id} onChange={e => set('pass_type_id', e.target.value)} placeholder="pass.com.example.loyalty"
            className={fieldCls} data-testid={testPrefix + '-pass-type'} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Team ID</span>
          <input value={f.team_id} onChange={e => set('team_id', e.target.value.toUpperCase())} placeholder="10 letters and digits"
            className={fieldCls} data-testid={testPrefix + '-team'} />
        </label>
      </div>
      <FileText label="Pass certificate (PEM)" value={f.cert_pem} onChange={v => set('cert_pem', v)} accept=".pem,.crt,.cer"
        placeholder="-----BEGIN CERTIFICATE-----" testId={testPrefix + '-cert'} />
      <FileText label="Its private key (PEM, no password)" value={f.key_pem} onChange={v => set('key_pem', v)} accept=".pem,.key"
        placeholder="-----BEGIN PRIVATE KEY-----" testId={testPrefix + '-key'} />
      <FileText label="Apple WWDR certificate (PEM)" value={f.wwdr_pem} onChange={v => set('wwdr_pem', v)} accept=".pem,.crt,.cer"
        placeholder="-----BEGIN CERTIFICATE-----" testId={testPrefix + '-wwdr'} />
      <p className="text-xs text-muted-foreground">
        From the Apple Developer site: Identifiers, Pass Type IDs, then Create Certificate. Export the certificate and key from
        Keychain as PEM (openssl pkcs12 -in cert.p12 -nodes). The WWDR certificate is Apple's G4 intermediate.
      </p>
      {error && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      <button type="submit" disabled={!ready || saving} data-testid={testPrefix + '-save'}
        className={cn('min-h-[48px] px-5 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 touch-manipulation')}>
        {saving ? <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Checking</span> : 'Check and save'}
      </button>
    </form>
  )
}

export function GoogleWalletForm({ onSave, saving, error, testPrefix = 'wallet-google' }) {
  const [f, setF] = useState({ issuer_id: '', service_account: '' })
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const ready = f.issuer_id.trim() && f.service_account.trim()
  return (
    <form className="space-y-3" autoComplete="off" onSubmit={e => { e.preventDefault(); if (ready) onSave(f) }}>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Issuer ID</span>
        <input value={f.issuer_id} onChange={e => set('issuer_id', e.target.value.replace(/\D/g, ''))} inputMode="numeric"
          placeholder="The number on the Google Pay & Wallet Console" className={fieldCls} data-testid={testPrefix + '-issuer'} />
      </label>
      <FileText label="Service account key (JSON)" value={f.service_account} onChange={v => set('service_account', v)} accept=".json,application/json"
        placeholder='{ "client_email": "...", "private_key": "..." }' testId={testPrefix + '-account'} />
      <p className="text-xs text-muted-foreground">
        In Google Cloud, make a service account and a JSON key for it; in the Google Pay & Wallet Console, add the account's
        email under Users with Developer access.
      </p>
      {error && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      <button type="submit" disabled={!ready || saving} data-testid={testPrefix + '-save'}
        className="min-h-[48px] px-5 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 touch-manipulation">
        {saving ? <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Checking</span> : 'Check and save'}
      </button>
    </form>
  )
}
