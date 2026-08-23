// Add customer modal
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { X, Minus } from 'lucide-react'

// ── Add customer modal ────────────────────────────────────────
export function AddCustomerModal({ api, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', notes: '', visit_count: 0 })
  const [error, setError] = useState(null)

  const createMutation = useMutation({
    mutationFn: () => api.post('/customers', {
      name:        form.name.trim(),
      email:       form.email.trim() || null,
      phone:       form.phone.trim() || null,
      notes:       form.notes.trim() || null,
      visit_count: form.visit_count,
    }),
    onSuccess: (data) => onCreated(data.id),
    onError:   (e)    => setError(e.message ?? 'Failed to create customer'),
  })

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    setError(null)
    createMutation.mutate()
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-background rounded-xl shadow-2xl w-full max-w-sm flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
            <p className="font-semibold text-sm">Add customer</p>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-accent"><X className="w-4 h-4" /></button>
          </div>
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            <EditField label="Name *">
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="field-input"
                placeholder="Full name"
                autoFocus={false}
                required
              />
            </EditField>
            <EditField label="Email">
              <input
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                type="email"
                inputMode="email"
                className="field-input"
                placeholder="email@example.com"
              />
            </EditField>
            <EditField label="Phone">
              <input
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                type="tel"
                inputMode="tel"
                className="field-input"
                placeholder="+44 7700 900000"
              />
            </EditField>
            <EditField label="Notes">
              <textarea
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                className="field-input min-h-[60px] resize-none"
                placeholder="Internal notes…"
              />
            </EditField>
            <EditField label="Historical visit count">
              <div className="flex items-center gap-2">
                <button type="button"
                  onClick={() => setForm(f => ({ ...f, visit_count: Math.max(0, f.visit_count - 1) }))}
                  className="w-9 h-9 rounded-lg border text-lg font-bold flex items-center justify-center hover:bg-accent touch-manipulation select-none"
                ><Minus className="w-4 h-4" /></button>
                <span className="w-12 text-center text-sm font-semibold tabular-nums">{form.visit_count}</span>
                <button type="button"
                  onClick={() => setForm(f => ({ ...f, visit_count: f.visit_count + 1 }))}
                  className="w-9 h-9 rounded-lg border text-lg font-bold flex items-center justify-center hover:bg-accent touch-manipulation select-none"
                >+</button>
                <span className="text-xs text-muted-foreground">pre-system visits</span>
              </div>
            </EditField>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={onClose} className="flex-1 py-2 border rounded-lg text-sm touch-manipulation">
                Cancel
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending || !form.name.trim()}
                className="flex-1 py-2 bg-primary text-primary-foreground rounded-lg text-sm disabled:opacity-50 touch-manipulation"
              >
                {createMutation.isPending ? 'Adding…' : 'Add customer'}
              </button>
            </div>
          </form>
        </div>
      </div>
      <style>{`.field-input{width:100%;border:1px solid hsl(var(--border));border-radius:.5rem;padding:.4rem .6rem;font-size:.875rem;background:hsl(var(--background));outline:none}.field-input:focus{border-color:hsl(var(--primary))}`}</style>
    </>
  )
}

function EditField({ label, children }) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground block mb-1">{label}</label>
      {children}
    </div>
  )
}
