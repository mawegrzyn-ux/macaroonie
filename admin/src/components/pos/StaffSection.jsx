// src/components/pos/StaffSection.jsx
//
// Till setup > Staff and PINs: who can sign in on the till and what their
// till role lets them do. People come from the Staff page; a PIN is 4 to
// 6 digits, unique per venue (the PIN alone finds the person), and is
// checked on the till itself so sign-in works offline.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Pencil, KeyRound } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Section, Modal, Field, inputCls, ErrorNote, Btn, Toggle } from './shared'

function StaffModal({ venueId, setup, person, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const [role, setRole] = useState(person.pos_role_id || '')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [removePin, setRemovePin] = useState(false)
  const pinOk = /^[0-9]{4,6}$/.test(pin)
  const mismatch = pin && pin2 && pin !== pin2
  const body = () => {
    const out = { pos_role_id: role || null }
    if (removePin) out.pin = null
    else if (pin) out.pin = pin
    return out
  }
  const canSave = !removePin && pin ? pinOk && pin === pin2 : true
  const save = useMutation({
    mutationFn: () => api.put(`/pos/venues/${venueId}/staff/${person.id}/pos`, body()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pos-setup', venueId] }); onClose() },
  })
  const digits = v => v.replace(/[^0-9]/g, '').slice(0, 6)
  return (
    <Modal title={person.name} onClose={onClose}
      footer={<Btn variant="primary" className="flex-1" disabled={!canSave || save.isPending} onClick={() => save.mutate()}>
        {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
      </Btn>}>
      <Field label="Till role" hint="What they can do on the till. With no role they can take orders and payments, nothing that needs a permission.">
        <select className={inputCls} value={role} onChange={e => setRole(e.target.value)}>
          <option value="">No role (orders and payments only)</option>
          {setup.roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </Field>
      {!removePin && (
        <div className="flex flex-wrap gap-4">
          <Field label={person.has_pin ? 'New PIN' : 'PIN'} hint="4 to 6 digits. Not 1111 or 1234.">
            <input className={cn(inputCls, 'w-36 tracking-widest')} type="password" inputMode="numeric" autoComplete="new-password"
              value={pin} onChange={e => setPin(digits(e.target.value))} aria-label="PIN" />
          </Field>
          <Field label="Type it again">
            <input className={cn(inputCls, 'w-36 tracking-widest')} type="password" inputMode="numeric" autoComplete="new-password"
              value={pin2} onChange={e => setPin2(digits(e.target.value))} aria-label="PIN again" />
          </Field>
        </div>
      )}
      {mismatch && <p className="text-xs text-destructive">The two PINs don't match.</p>}
      {pin && !pinOk && <p className="text-xs text-destructive">A PIN is 4 to 6 digits.</p>}
      {person.has_pin && <Toggle label="Remove their PIN" hint="They can't sign in on the till until they get a new one." checked={removePin} onChange={setRemovePin} />}
      <ErrorNote error={save.error} />
    </Modal>
  )
}

export default function StaffSection({ venueId, setup }) {
  const [editing, setEditing] = useState(null)
  const roleName = id => setup.roles.find(r => r.id === id)?.name
  return (
    <Section title="Staff and PINs" hint="Each person signs in on the till with their own PIN. Tills check PINs themselves, so signing in works without the internet.">
      {!setup.staff.length
        ? <p className="text-sm text-muted-foreground">No staff at this venue yet. Add people on the <Link to="/staff" className="underline">Staff page</Link>.</p>
        : (
          <div className="rounded-xl border divide-y">
            {setup.staff.map(p => (
              <div key={p.id} className="flex items-center gap-3 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {roleName(p.pos_role_id) || 'No till role'} · {p.has_pin
                      ? <span className="inline-flex items-center gap-1"><KeyRound className="w-3 h-3" /> PIN set</span>
                      : 'No PIN'}
                  </p>
                </div>
                <Btn onClick={() => setEditing(p)} title={'Edit ' + p.name}><Pencil className="w-4 h-4" /></Btn>
              </div>
            ))}
          </div>
        )}
      <p className="text-xs text-muted-foreground">People are added and removed on the <Link to="/staff" className="underline">Staff page</Link>.</p>
      {editing && <StaffModal venueId={venueId} setup={setup} person={editing} onClose={() => setEditing(null)} />}
    </Section>
  )
}
