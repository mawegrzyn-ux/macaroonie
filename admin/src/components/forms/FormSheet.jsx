// src/components/forms/FormSheet.jsx
//
// The forms that open in a sheet over the page, each the same panel its own
// page uses and saving through the same routes (docs/CHAT_FIRST.md F1-F9).
// Opened by the tasks on Home (Home.jsx) and the phone's Today (MobileToday.jsx) and by
// Pepper's form cards (ChatView.jsx, the open_form tool, OUTSTANDING 44 item
// 3). `form` is { form, ref, task? }: form is a key of FORMS; ref holds the
// day (date), the week (week) or the checklist (template); task.title names
// a checklist. Sold out opens the Online orders window of its own
// (AvailabilityModal) instead of a sheet: FormOpener picks.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ExternalLink, X, Loader2 } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { cn } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { TempChecksTable, HoldChecksTable, CookingChecksPanel, DeliveryChecksPanel } from '@/components/foodSafety/shared'
import { ChecklistRunPanel } from '@/components/checklists/shared'
import { DayView, StatusBadge, SaveIndicator } from '@/pages/CashRecon'
import { WeekWagesEditor } from '@/components/cashRecon/WagesTable'
import { PettyCashPanel } from '@/pages/mobile/MobileExpenses'
import { RotaGrid, RotaDayList, useRotaPerms } from '@/components/staff/rota'
import { AvailabilityModal } from '@/components/orders/shared'
import { FORMS } from '@shared/forms.js'

const todayIso = () => new Date().toISOString().slice(0, 10)

// The forms (shared/forms.js, one list with Pepper's open_form): each one's
// title, module, full page (F8) and phone page.
export { FORMS }

/** A link inside the app, or (on the phone app's own host) to the office: linkFor maps it. */
export function Go({ to, linkFor, ...rest }) {
  const dest = linkFor ? linkFor(to) : { to }
  return dest.href ? <a href={dest.href} {...rest} /> : <Link to={dest.to} {...rest} />
}

/** A day of the rota: who is on, and the week's grid on that day (changes need Rota manage). */
function RotaDaySheet({ venueId, date }) {
  const { canEditRota } = useRotaPerms()
  const d = parseISO(date)
  const monday = format(new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)), 'yyyy-MM-dd')
  return (
    <div className="space-y-4">
      <RotaDayList venueId={venueId} weekStart={monday} day={date} />
      <div className="overflow-x-auto">
        <RotaGrid venueId={venueId} weekStart={monday} canEdit={canEditRota} selectedDay={date} dense />
      </div>
    </div>
  )
}

/** The sheet's title: the task's own for a checklist, the day or week for Cash Recon. */
export function formTitle(form, meta, date = null) {
  if (form.form === 'checklist') return form.task?.title || form.ref?.template?.name || 'Checklist'
  if (form.form === 'cash_up') return 'Cash-up for ' + format(parseISO(form.ref.date), 'EEEE d MMMM')
  if (form.form === 'wages') return 'Wages for the week of ' + format(parseISO(form.ref.week), 'd MMMM')
  if (form.form === 'expense') return 'Expenses for ' + format(parseISO(form.ref.date), 'EEEE d MMMM')
  if (form.form === 'rota_day') return 'Rota for ' + format(parseISO(form.ref.date), 'EEEE d MMMM')
  if (form.form === 'delivery') return 'Delivery checks for ' + format(parseISO(form.ref?.date ?? date ?? todayIso()), 'EEEE d MMMM')
  return meta.title
}

/** F1-F9: the form for a task, the same panel its page uses, saving through the same routes. */
export function FormSheet({ form, venueId, date, onClose, linkFor }) {
  const qc = useQueryClient()
  const { canUse: cashUse, canManage: cashManage } = usePermission('cash_recon')
  const meta = FORMS[form.form] || { title: form.task?.title || 'Form', path: '/' }
  const title = formTitle(form, meta, date)
  // The full page: on the phone a form may have a phone page of its own.
  const page = linkFor && meta.phone ? { to: meta.phone, linkFor: null } : { to: meta.path, linkFor }
  // A cash-up's state from DayView (status, saving, Submit): shown in the foot.
  const [day, setDay] = useState(null)
  const submitted = !!day?.isSubmitted
  useEffect(() => { if (submitted) qc.invalidateQueries({ queryKey: ['ops-today'] }) }, [submitted, qc])
  const cashUp = form.form === 'cash_up' && day?.ready
  // The wages editor saves only on Save: closing with changes waiting asks
  // first, so Done never throws a payment away without a word.
  const [wages, setWages] = useState(null)
  const unsaved = form.form === 'wages' && !!wages?.dirty
  const [asking, setAsking] = useState(false)
  useEffect(() => { if (!unsaved) setAsking(false) }, [unsaved])
  const close = () => (unsaved ? setAsking(true) : onClose())
  const saveAndClose = async () => { if (await wages.save()) onClose() }
  const footBtn = 'min-h-[48px] px-5 rounded-md font-medium touch-manipulation disabled:opacity-50'
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center sm:p-4" onClick={close} data-testid="today-form" data-form={form.form}>
      <div className="bg-background w-full sm:max-w-4xl max-h-[85vh] overflow-y-auto rounded-t-xl sm:rounded-xl shadow-xl"
        onClick={e => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="sticky top-0 z-10 bg-background border-b px-4 h-14 flex items-center gap-2">
          <h2 className="font-semibold truncate" data-testid="today-form-title">{title}</h2>
          <Go to={page.to} linkFor={page.linkFor} className="ml-auto shrink-0 inline-flex items-center gap-1 text-sm text-primary min-h-[48px] px-2 touch-manipulation" data-testid="today-form-page">
            Open the full page <ExternalLink className="w-3.5 h-3.5" />
          </Go>
          <button type="button" onClick={close} aria-label="Close" data-testid="today-form-close"
            className="w-12 h-12 rounded-md flex items-center justify-center hover:bg-accent touch-manipulation">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-3 sm:p-4">
          {form.form === 'temps' && <TempChecksTable venueId={venueId} date={date} />}
          {form.form === 'holds' && <HoldChecksTable venueId={venueId} date={date} />}
          {form.form === 'cooking' && <CookingChecksPanel venueId={venueId} date={date} />}
          {form.form === 'checklist' && <ChecklistRunPanel template={form.ref.template} date={date} />}
          {form.form === 'cash_up' && <DayView venueId={venueId} date={form.ref.date} hideHeader onStateChange={setDay} />}
          {form.form === 'expense' && <PettyCashPanel venueId={venueId} date={form.ref.date} />}
          {form.form === 'delivery' && <DeliveryChecksPanel venueId={venueId} date={form.ref?.date ?? date} />}
          {form.form === 'rota_day' && <RotaDaySheet venueId={venueId} date={form.ref.date} />}
          {form.form === 'wages' && (
            <WeekWagesEditor venueId={venueId} weekStart={form.ref.week} readOnly={!cashUse} canSetDefault={cashManage}
              showBank={!linkFor} hidePaidOnForAll={!!linkFor} onStateChange={setWages} />
          )}
        </div>
        <div className="sticky bottom-0 bg-background border-t px-4 py-3 flex flex-wrap items-center justify-end gap-2">
          {asking ? (
            <>
              <p className="mr-auto text-sm font-medium" data-testid="today-unsaved">The changes to the wages aren't saved.</p>
              <button type="button" onClick={() => setAsking(false)} data-testid="today-unsaved-stay"
                className={cn(footBtn, 'border hover:bg-accent')}>Keep editing</button>
              <button type="button" onClick={onClose} data-testid="today-unsaved-discard"
                className={cn(footBtn, 'border text-destructive hover:bg-destructive/10')}>Close without saving</button>
              <button type="button" onClick={saveAndClose} disabled={wages?.saving} data-testid="today-unsaved-save"
                className={cn(footBtn, 'bg-primary text-primary-foreground')}>
                {wages?.saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save and close'}
              </button>
            </>
          ) : (
            <>
              {cashUp && (
                <div className="mr-auto flex items-center gap-2 min-w-0" data-testid="today-cash-state" data-status={day.status}>
                  <StatusBadge status={day.status} />
                  <SaveIndicator saving={day.saving} saved={day.saved} error={day.saveErr} />
                </div>
              )}
              {cashUp && !day.isSubmitted && day.weekly && (
                <span className="text-xs text-muted-foreground" data-testid="today-cash-weekly">Saved. The week is submitted in one go.</span>
              )}
              {cashUp && !day.isSubmitted && day.canSubmit && (
                <button type="button" onClick={day.submit} disabled={day.submitPending} data-testid="today-cash-submit"
                  className={cn(footBtn, 'bg-green-600 text-white hover:bg-green-700')}>
                  {day.submitPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Submit'}
                </button>
              )}
              {cashUp && day.isSubmitted && day.canUnsubmit && (
                <button type="button" onClick={day.unsubmit} disabled={day.submitPending} data-testid="today-cash-unsubmit"
                  className={cn(footBtn, 'border hover:bg-accent')}>
                  {day.submitPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Unsubmit'}
                </button>
              )}
              <button type="button" onClick={close} data-testid="today-form-done"
                className="min-h-[48px] px-6 rounded-md bg-primary text-primary-foreground font-medium touch-manipulation">Done</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** A form from FORMS: the sheet, or for sold out the Online orders window. */
export function FormOpener({ form, venueId, date, onClose, linkFor }) {
  if (form.form === 'sold_out') return <AvailabilityModal venueId={venueId} onClose={onClose} />
  return <FormSheet form={form} venueId={venueId} date={date} onClose={onClose} linkFor={linkFor} />
}
