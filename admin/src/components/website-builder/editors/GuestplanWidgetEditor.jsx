// Editor for the Guestplan booking widget embed block.
//
// Guestplan doesn't publish a documented colour/theme API for the embed
// snippet itself (we could not reach docs.guestplan.com to verify one),
// so this can't be wired to the site theme automatically the way our
// own reservations_widget block is. The custom CSS field is a manual,
// best-effort escape hatch for operators willing to inspect the live
// widget's markup themselves — it has no effect if Guestplan renders
// inside a cross-origin iframe.
import { FormRow } from '../shared'

export function GuestplanWidgetEditor({ data, onChange }) {
  const set = (k) => (v) => onChange({ ...data, [k]: v })
  return (
    <div className="space-y-3">
      <FormRow label="Access key"
        hint="From your Guestplan account — the accessKey value in their embed snippet.">
        <input value={data.access_key || ''} onChange={e => set('access_key')(e.target.value)}
          placeholder="e.g. 2a5c03b9db21ba872c0d9e5ec53ec55c5735eb69"
          className="w-full text-sm border rounded-md px-2 py-1.5 font-mono" />
      </FormRow>
      <FormRow label="Heading (optional)"
        hint="Guestplan's script controls its own layout, so this heading just sits above where it mounts.">
        <input value={data.heading || ''} onChange={e => set('heading')(e.target.value)}
          className="w-full text-sm border rounded-md px-2 py-1.5" />
      </FormRow>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={!!data.launcher_mode}
          onChange={e => set('launcher_mode')(e.target.checked)} />
        <span>
          Start closed — show only a floating "Book a table" button
          <span className="block text-xs text-muted-foreground mt-0.5">
            Guestplan doesn't publish a documented option to force their widget closed on
            load (it decides its own default, which can be expanded on desktop). This
            works around that by not loading Guestplan's script at all until the visitor
            clicks the floating button — so nothing of theirs mounts on the page until
            then, regardless of what their script would otherwise default to.
          </span>
        </span>
      </label>
      <FormRow label="Custom CSS (advanced, best effort)"
        hint="Guestplan doesn't document a colour/theme option we can verify, so this isn't linked to your site theme. Paste CSS here only if you've inspected the live widget's HTML yourself — it has no effect if Guestplan renders inside an iframe.">
        <textarea value={data.custom_css || ''} onChange={e => set('custom_css')(e.target.value)}
          rows={4} placeholder=".gstpln-widget-button { background: #630812 !important; }"
          className="w-full text-sm border rounded-md px-2 py-1.5 font-mono" />
      </FormRow>
    </div>
  )
}
