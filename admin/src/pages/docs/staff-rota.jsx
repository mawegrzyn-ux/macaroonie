// src/pages/docs/staff-rota.jsx
// The Docs page's "Staff & Rota" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, DataTable } from './parts.jsx'

export const id = 'staff-rota'
export const label = 'Staff & Rota'
export const order = 200

// ── STAFF & ROTA ──────────────────────────────
export function Section() {
  return (
    <section id="staff-rota" data-doc="">
      <H2>Staff &amp; Rota</H2>
      <P>
        Migration 106. Pages: <Mono>/staff</Mono> (<Mono>Staff.jsx</Mono>),{' '}
        <Mono>/staff/roles</Mono> (<Mono>StaffRoles.jsx</Mono>), <Mono>/rota</Mono>{' '}
        (<Mono>Rota.jsx</Mono>), <Mono>/rota/setup</Mono> (<Mono>RotaSetup.jsx</Mono>),{' '}
        <Mono>/rota-dashboard</Mono> (<Mono>RotaDashboard.jsx</Mono>). Shared UI in{' '}
        <Mono>components/staff/shared.jsx</Mono> (venue choice, sortable rows, modal, time
        select) and <Mono>components/staff/rota.jsx</Mono> (<Mono>RotaGrid</Mono>,{' '}
        <Mono>RotaDayList</Mono>, <Mono>RotaPayTable</Mono>, <Mono>RotaTipsTable</Mono>), used
        unchanged by both the Rota page and the dashboard widgets. API:{' '}
        <Mono>routes/rota.js</Mono> at <Mono>/api/rota</Mono>; maths in{' '}
        <Mono>services/rotaCalc.js</Mono> (<Mono>computeRotaWeek()</Mono>, pure, the one
        implementation used by GET pay and fill-wages).
      </P>
      <H3>Scope</H3>
      <P>
        Tenant-wide: roles, shifts, rota settings (one company, one set of rules; a new tenant
        starts empty). Per venue: staff (<Mono>cash_staff</Mono>, the same rows Cash Recon wages
        use), rota entries, weekly pay/points adjustments.
      </P>
      <H3>Leaving and off-rota periods (migration 164)</H3>
      <P>
        A person is off the rota on a day when it is after their <Mono>cash_staff.left_on</Mono>{' '}
        (last working day) or inside one of their <Mono>staff_rota_off</Mono> periods.{' '}
        <Mono>loadOffDays(tx, tenantId, venueId, dates)</Mono> in <Mono>routes/rota.js</Mono> is
        the one place that works this out, and every reader goes through it: GET week (blocked{' '}
        <Mono>off_days</Mono> per row, no row for someone off all seven days, the{' '}
        <Mono>away_staff</Mono> list), the entries PUT (422 on those days), copy (skips them) and{' '}
        <Mono>computeWeek()</Mono> (no pay row unless they have money that week). Only the days
        themselves change: weeks before a leaving date or outside a period are untouched, so old
        rotas, pay and tips still show the person. Setting a leaving date or adding a period deletes
        the person&apos;s entries on those days (a <Mono>dry_run</Mono> call counts them first, and
        the Staff page asks before going ahead); clearing the date or removing the period
        doesn&apos;t bring them back. People who left before a week are also left out of new wage
        weeks and the wages Add person list (<Mono>leftBeforeWeek()</Mono> in{' '}
        <Mono>CashRecon.jsx</Mono>), and from the day after their last day they drop out of the
        till&apos;s sign-in list (<Mono>loadTillStaff(..., {'{ signIn: true }'})</Mono> in{' '}
        <Mono>posSvc.js</Mono>, used by <Mono>tillConfig()</Mono>; the sequencer still knows them,
        so a late-synced sale from their last day is accepted). <Mono>is_active</Mono> is separate:
        off hides someone from every week. Admin: <Mono>LeavingSection</Mono> and{' '}
        <Mono>OffPeriodsSection</Mono> in <Mono>pages/Staff.jsx</Mono>, <Mono>AwayCell</Mono> and
        the Off the rota all week strip in <Mono>RotaGrid</Mono>, Left / Off rota cells in{' '}
        <Mono>buildRotaSheet()</Mono>.
      </P>
      <H3>Schema</H3>
      <DataTable
        head={['Table', 'Purpose']}
        rows={[
          ['staff_roles', 'Tenant job titles: name, points_multiplier numeric(5,2) default 1, sort_order, is_active. cash_staff.role_id references it ON DELETE SET NULL.'],
          ['rota_settings', 'One row per tenant: mode (day_parts | hourly), slot_minutes (15 | 30 | 60), tip_round_to (numeric, null = to the penny) and tip_round_mode (nearest | up | down), migration 107; hide_closed_on_rota and hide_closed_on_print (booleans, default false), migration 110 (hide_totals_on_print, migration 114, dropped by 194). Missing row = day_parts / 30 / no rounding / show every day.'],
          ['rota_shifts', 'Day parts: name, start_time, end_time (end <= start runs past midnight), points, sort_order, is_active. Deleting a shift used by any entry only hides it.'],
          ['staff_shift_rates', 'Per staff per shift rate (PK staff_id, shift_id): hourly rate for hourly staff, amount per shift for fixed/shift staff. Replaced wholesale by the staff PATCH shift_rates array.'],
          ['rota_entries', 'venue_id, staff_id, work_date, and either shift_id (day-part tick) or start_time + end_time (hourly period); CHECK enforces one or the other. Partial unique index on (staff_id, work_date, shift_id). status (text, default on, CHECK on | sick | pto | uto | abs), migration 129: working or a kind of time off.'],
          ['tip_pots', 'Migration 108. Tenant-wide pots: name, distribution (house | points | manual), sort_order, is_active; surcharges (jsonb array of { name, pct 0-100 }, in the order applied, default []), migration 116; it replaced the single surcharge_name + surcharge_pct, which 116 copied into the array and dropped. PotBody takes surcharges (max 10); blank names are stored as null and 0% rows dropped (cleanSurcharges), written with tx.json. cash_sc_sources.tip_pot_id (ON DELETE SET NULL) says which pot a Cash Recon source feeds; it replaced cash_sc_sources.distribution (house/staff/split), which only ever fed the old single rota pot. Migration 143 adds payout_method (cash | bank) and payout_to (shares | people), both in PotBody.'],
          ['tip_pot_lines', 'Named manual lines per pot (cascade). kind (amount | percent, migration 115). Values per venue week in rota_week_pot_lines (PK venue_id, week_start, line_id): £ for amount lines, % for percent lines; either may be negative (migration 115 dropped the amount >= 0 check).'],
          ['rota_week_pot_payees', 'Migration 143. Who a payout_to = people pot is paid to: one row per venue, week_start and pot (PK), staff_ids uuid[]. computeWeek() uses the latest row with week_start <= the week (DISTINCT ON pot_id ... ORDER BY week_start DESC), so a pick carries forward and older weeks keep theirs; an empty array means nobody. Set by PUT .../pots/:potId/payees { staff_ids } (rota_tips manage, staff must belong to the venue). Payees are added to the staff loaded for the week so a deactivated payee still shows.'],
          ['rota_week_pot_manual', 'Manual distribution: amount per venue, week, pot and staff. Replaced per pot by PUT .../pots/:potId/manual.'],
          ['rota_week_staff', 'Per venue, week, staff: pay_override; tip_unallocated (numeric(10,2) default 0, migration 119) is the person\'s net +/- nudge in £ (negative = given to the unallocated pot); points_nudge (numeric(8,2) default 0, migration 151) is their net +/- point tap; removed (boolean default false, migration 155) takes the person off that venue week\'s rota. (points_adjustment and tip_adjustment were dropped in migration 113.)'],
          ['cash_staff.left_on / left_note', 'Migration 164. left_on (date, null = still on the staff) is the person\'s last working day; left_note (text) the reason. From left_on + 1 they are off the rota: loadOffDays() marks those days { kind: \'left\' }, and a person off every day of a week has no row in it. Earlier weeks are untouched.'],
          ['staff_rota_off', 'Migration 164. Periods a person is off the rota: tenant_id, staff_id (cascade), from_date, to_date (both included, CHECK to >= from), note, created_by. RLS. Periods for one person never overlap (the POST refuses it); at most 731 days each. loadOffDays() marks the days { kind: \'off\', from, until, note }; a leaving date wins on a day both cover.'],
          ['rota_tip_moves / rota_tip_move_lines', 'Migration 113. One row per move: venue, week_start, kind (points | money), from_staff_id, note, created_by, created_at; lines: to_staff_id + amount (> 0, 2 decimals). ON DELETE CASCADE from the move. Migration 117 added action (move | add | remove; from_staff_id is set only for a move, CHECK-enforced): add gives each line its amount, remove takes it off, with no counterpart. computeRotaWeek() sums them into each person\'s points_adjustment / tip_adjustment, and totals.tips_added / tips_taken_out (money only).'],
        ]}
      />
      <H3>API</H3>
      <DataTable
        head={['Route', 'Module', 'Notes']}
        rows={[
          ['GET /setup', 'any signed-in user', 'settings + shifts + roles'],
          ['PATCH /settings; POST/PATCH/DELETE /shifts[/:id]; PUT /shifts/reorder; same for /roles', 'staff manage', ''],
          ['GET/POST/PATCH/DELETE /venues/:venueId/staff[/:id]; PUT .../staff/reorder', 'staff', 'Staff with wage or rota history are deactivated, not deleted. GET returns left_on, left_note and off_periods [{ id, from_date, to_date, note }] (loadStaff withPeriods).'],
          ['PUT .../staff/:id/leaving { left_on: date | null, note?, dry_run? }', 'staff manage', 'Migration 164. dry_run returns { entries }: the person\'s rota_entries after left_on. Otherwise sets left_on / left_note, deletes those entries and returns { left_on, removed_entries }. null clears the date (deleted entries stay deleted). 404 for someone not in that venue.'],
          ['POST .../staff/:id/off-periods { from_date, to_date, note?, dry_run? }; DELETE .../off-periods/:periodId', 'staff manage', 'Migration 164. 400 when to is before from or the period is over 731 days; 422 when it overlaps one of the person\'s periods (names it). dry_run returns { entries } inside the dates; otherwise inserts, deletes those entries and returns the row + removed_entries. DELETE only removes the period.'],
          ['GET /venues/:venueId/weeks/:week', 'rota view', 'week_start, dates, open_dates, settings, shifts, staff (active plus anyone with entries, less people removed from the week who have none and people off the rota all week; each with sort_order, left_on and off_days { date: { kind: left, left_on, note } | { kind: off, from, until, note } }), entries, removed_staff (active people removed from this week with no entries: id, name, role_name, is_active, sort_order), away_staff (migration 164: active people off the rota every day of the week with no entries, other than those who left before it: id, name, sort_order plus the first day\'s off fields). :week may be any date; it snaps to Monday. open_dates is null when the venue has no venue_schedule_templates rows (nothing is hidden), otherwise the open dates from resolveOpenDaysForWeek().'],
          ['PUT .../weeks/:week/entries', 'rota manage', 'Whole-week replace (both modes). Each entry takes status (default on). The Clear rota button just saves an empty list. Optional removed_staff_ids (migration 155): the whole list of people off this week\'s rota; sent, it sets rota_week_staff.removed for them and clears it for everyone else in the venue week; absent, removals stay as they are. 400 for a date outside the week or a staff id not in the venue, 422 for overlapping periods for one person on one day, for entries belonging to someone in removed_staff_ids, or (migration 164) for an entry on a day the person is off the rota (after their leaving date, or in an off-rota period); the message names the person and the dates. Duplicate shift ticks are dropped. The grid drops entries on those days before saving, so an old draft still saves.'],
          ['POST .../weeks/:week/copy { from_week }', 'rota manage', 'Replaces the week with another week\'s worked (status on) entries, shifted by whole weeks. Time off is never copied, and nor are the shifts of people removed from this week or shifts landing on a day the person is off the rota (migration 164) (the response gives copied and skipped counts); 422 when the source week has nobody working, or only people removed from this week (nothing is replaced).'],
          ['GET .../weeks/:week/pay', 'rota_pay or rota_tips view', 'computeRotaWeek result: rows (incl. pot_shares / pot_shares_exact by pot id, tip_share total), pots (sources, lines, total, distributed, difference, kept_by_house), totals (hours, pay, points, tips_in, tips_shared, kept_by_house), tip_rounding. computeWeek() leaves out people removed from the week (rota_week_staff.removed), and people off the rota all week (migration 164: left before it or in an off-rota period), unless they have something that week: entries, a pay override, a pay adjustment, carried_owed, a manual pot amount, a tip move, a nudge or tap, or a people pot paid to them.'],
          ['GET /setup pots; GET /sc-sources; POST/PATCH/DELETE /pots[/:id]; PUT /pots/reorder; PUT /pots/:id/sources { source_ids }; POST /pots/:id/lines; PATCH/DELETE /pot-lines/:id; PUT /pots/:id/lines/reorder', 'staff', 'Tip pot setup. Listing a source in PUT sources moves it from any other pot; sources no longer listed are unassigned. Deleting a pot unassigns its sources and cascades its lines and weekly amounts.'],
          ['PUT .../weeks/:week/pot-lines { amounts: [{ line_id, amount }] }; PUT .../weeks/:week/pots/:potId/manual { amounts: [{ staff_id, amount }] }', 'rota_tips manage', 'Weekly manual line values (null clears; may be negative; percent lines 400 outside -100..100) and manual shares (422 unless the pot is manual). Both return the recomputed pay payload. POST /pots/:id/lines takes { name, kind }.'],
          ['PATCH .../staff/:staffId { pay_override }, POST .../tip-moves { kind, action (move | add | remove, default move), from_staff_id (move only), lines: [{ to_staff_id, amount }], note (required for add / remove) }, DELETE .../tip-moves/:id, POST .../reset-moves { kind: points | money | all }', 'rota_pay manage (pay override); rota_tips manage (moves, reset)', 'Each returns the recomputed pay payload (which includes moves: each with from_name, lines with names, total). A move whose lines add up to more than the giver has now (points, or tip_share for money) is 422, and so is a remove line bigger than that person\'s balance; moving to yourself or listing a person twice is 400. The UI (TipMoveModal in rota.jsx) turns equal / by amount / by % into final amounts with splitEvenly() / splitByPercent(), which work in hundredths so the lines add up exactly.'],
          ['POST .../tip-nudge { staff_id, direction: plus | minus }; POST .../reset-unallocated', 'rota_tips manage', 'Moves 0.50 (NUDGE_STEP in rota.js) between the person\'s tip total and the week\'s unallocated pot by adding -0.50 / +0.50 to rota_week_staff.tip_unallocated. Minus is 422 when the person\'s tip_share is under 0.50, plus is 422 when totals.tips_unallocated is under 0.50. A pg_advisory_xact_lock on the venue week serialises rapid taps so two can\'t pass the same balance check. reset-unallocated sets every nudge back to 0. computeRotaWeek() adds tip_unallocated into tip_share and reports totals.tips_unallocated = -sum of nudges; the UI is NudgeCells in rota.jsx (the -/+ buttons get a column each so the total lines up under its heading).'],
          ['POST .../points-nudge { staff_id, direction: plus | minus }; POST .../reset-points-nudges', 'rota_tips manage', 'Migration 151. Moves 0.5 (POINTS_STEP in rota.js) between the person\'s points and the week\'s spare points (rota_week_staff.points_nudge, net per person; spare points = -sum). Minus is 422 when the person\'s points are under 0.5, plus is 422 when totals.points_unallocated is under 0.5. Same advisory lock as tip-nudge. computeRotaWeek() adds points_nudge to the person\'s points (with point moves, floored at 0) and shares each points pot over everyone\'s points plus the spare points, so a minus tap changes nobody else\'s share; the spare points\' part is pot.unallocated (the remainder after people\'s exact shares, so it takes the odd penny), totals.tips_unallocated_points. A people pot pays its payees total - unallocated. reset-points-nudges sets every tap back to 0. UI: PointsCells in rota.jsx (+ disabled without a spare point); the Changed column shows points_adjustment + points_nudge.'],
          ['Carry-over', '—', 'What a week leaves unallocated carries into the next week: carriedIn() in rota.js = -sum(tip_unallocated) over every earlier week of the venue plus, for each earlier week with spare points left (sum(points_nudge) < 0), that week\'s totals.tips_unallocated_points (computeWeek(..., { carry: false }), so no recursion; usually no such weeks). computeRotaWeek({ carriedIn }) returns totals.tips_carried_in, tips_unallocated = carriedIn - sum(this week\'s tip_unallocated) (what + £ taps can hand out), points_unallocated, tips_unallocated_points and tips_carry_out = tips_unallocated + tips_unallocated_points. Changing an earlier week changes every later week\'s carry. Pay, fill-wages and the tip-move balance check call computeWeek with carry: false.'],
          ['POST .../pay-adjustments { staff_id, kind: extra | deduction | advance, amount > 0, note }; PATCH .../pay-adjustments/:id { amount?, note? }; DELETE .../pay-adjustments/:id', 'rota_pay manage', 'Migration 137. Each returns the recomputed pay payload. The staff member must belong to the venue. An advance also inserts an advance_repay row (same amount and note, source_id = the advance) in the following week; changing the advance\'s amount changes its repayment too if the repayment still equals the old amount; deleting the advance cascades to it. advance_repay can\'t be created directly but can be edited or deleted like any row.'],
          ['POST .../fill-wages', 'rota_pay manage', 'Upserts the cash_wage_reports header, updates rostered people\'s cash_wage_entries by staff_id (fully paid rows stay fully paid at the new total), inserts the rest, leaves other rows alone. Rostered includes anyone with pay adjustments or carried_owed. The total written is pay (after adjustments); hourly people get hours = paid_hours (worked + PTO) and rate = base_pay / paid_hours. Notes list the adjustments (new rows, or existing rows with empty notes). bank_amount = the row\'s bank_pay; a row whose cash due was fully paid stays fully paid at the new cash_pay. Tips are not written.'],
        ]}
      />
      <H3>Calculation (services/rotaCalc.js)</H3>
      <P>
        Times are minutes from the start of the work date; an end at or before the start adds
        24h. A day-part entry counts its whole shift. An hourly period counts its own minutes
        and, for each shift it overlaps, that shift in proportion (overlap / shift length);
        minutes outside every shift count as hours but earn no points.
      </P>
      <P>
        Entry status (migration 129): only <Mono>on</Mono> entries count as hours worked, days
        worked, shift fractions and points. <Mono>pto</Mono> is paid exactly like working it
        (hourly minutes, and it counts as a day for fixed / day and as having an entry for fixed /
        week). <Mono>sick</Mono>, <Mono>uto</Mono> and <Mono>abs</Mono> are unpaid. Each row
        reports hours (worked), paid_hours (on + pto), paid_days and absence_hours{' '}
        <Mono>{'{ sick, pto, uto, abs }'}</Mono>; totals add paid_hours.
      </P>
      <DataTable
        head={['Figure', 'Rule']}
        rows={[
          ['Hourly pay', 'Minutes in a shift at that shift\'s staff_shift_rates rate (else default_rate); minutes outside any shift at default_rate.'],
          ['Fixed / week', 'default_rate if the person has any on or pto entry that week.'],
          ['Fixed / day', 'default_rate x distinct days with an on or pto entry.'],
          ['Fixed / shift', 'Sum of (shift amount x fraction worked); shift amount = staff_shift_rates rate, else default_rate.'],
          ['Pay override', 'rota_week_staff.pay_override replaces the computed pay for that week (base_pay).'],
          ['Tip payout', 'Migration 143. computeRotaWeek() works out, per person, tip_cash and tip_bank (totals tips_cash = cash paid out, tips_bank, tips_handed_on) after tip_share. Pots paid to shares pay each person their pot share in the pot\'s payout_method. A people pot with payees for the week pays its whole amount to them (split equally in pence, splitPence()): its real total for a points pot, distributed for a manual one; each pot reports payout_method, payout_to, payees [{ staff_id, name, amount }], paid_to_people, no_payees (people pot with nobody picked, paid as shares) and payees_week. Then tip_balance = tip_share − what the pots paid the person is added to their cash (tip_settled_in = cash), or to bank when no shared pot is paid in cash; that also pays out tip moves and nudges. A negative tip_cash / tip_bank means the person was paid more than their share and hands that much on. The new row and total fields are in TIP_ROW_FIELDS / TIP_TOTAL_FIELDS. UI: PotPayout + PayeesModal on each pot card and Bank / Cash columns (hasPayoutSplit()) in RotaTipsTable; Paid in / Paid to in the pot editor (TipPotsSetup.jsx).'],
          ['Pay adjustments', 'rota_pay_adjustments (migration 137): venue, staff, week_start, kind extra | deduction | advance | advance_repay, amount > 0, note, source_id (repay → its advance, ON DELETE CASCADE). computeRotaWeek({ payAdjustments, carriedOwed }) returns base_pay, adjustments[], extra_pay, deductions, advance, advance_repay, carried_owed, pay = max(0, base_pay + extra − deductions + advance − advance_repay + carried_owed) and pay_shortfall (the part below 0, not carried). carried_owed comes from last week\'s Cash Recon wage rows with cash_amount > 0 and cash_amount + bank_amount < total (sum of total − bank_amount − cash_amount per staff_id), loaded in computeWeek(). Pay method (migration 140): cash_staff.pay_method cash | bank | split + bank_amount (split: that much by bank each week, the rest cash); computeRotaWeek() splits pay with splitPay() in shared/payMethod.js into bank_pay / cash_pay (rows) and pay_bank / pay_cash (totals), all redacted without rota_pay. RotaPayTable shows Bank and Cash columns when showSplit (the Rota page: auto, when anyone has bank_pay; the Hours and pay widget: its show_bank option). All these fields are in PAY_ROW_FIELDS, so redactWeek() strips them without rota_pay. UI: the Adjustments column and PayAdjustModal in rota.jsx.'],
          ['Points', 'Sum of shift.points x fraction x role multiplier (1 with no role), plus points_adjustment (sum of point moves in minus out), plus points_nudge (the +/- half-point taps, migration 151), floored at 0.'],
          ['Pot total', 'gross = sum of the venue\'s week cash_sc_entries for sources with that tip_pot_id, plus the pot\'s manual lines for the week: base = sources + £ lines (floored at 0), each percent line adds round2(base x pct / 100), so % lines never compound; gross = max(0, sources + every line\'s value). Each line in the summary carries value (its £ effect). surcharges apply in order, each amount = round2(remaining x pct / 100) where remaining starts at gross and drops by each amount, so they compound; surcharge = gross - remaining; total (what is shared, and what difference is measured against) = remaining. Pot summaries return gross, surcharges ([{ name, pct, amount }]), surcharge (their sum) and total; totals add tips_gross and surcharges (tips_in stays after surcharges). Active pots are listed, plus inactive ones still holding money that week.'],
          ['Points pot share', 'pot total x person points / total points (pot_shares_exact), rounded to a multiple of rota_settings.tip_round_to with tip_round_mode nearest | up | down (migration 107; roundTip() works in whole pence).'],
          ['Manual pot share', 'rota_week_pot_manual amount for the person (staff with an amount are loaded even if inactive).'],
          ['House pot', 'No shares; its total is reported as kept_by_house.'],
          ['Per pot', 'distributed = sum of shares; difference = distributed - total (rounding over/under for points, still to share for manual). A person\'s tip_share is the sum across pots (tip_share_from_pots) plus tip_adjustment, floored at 0.'],
        ]}
      />
      <H3>Frontend</H3>
      <P>
        <Mono>RotaGrid</Mono> holds a local draft of the week in the current mode only and
        saves it with one PUT. Drafts are kept in a module-level <Mono>draftCache</Mono> keyed
        by venue, week and mode, so switching weeks does not lose edits; saving or discarding
        clears it. Entries from the other mode are counted in a notice and are replaced on
        save. Each name has a <Mono>ModeButton</Mono> (per-person tap mode, module-level{' '}
        <Mono>modeCache</Mono>, menu portalled to body so the sticky name cells don't cover it);
        a day-part tap adds an entry with that status, removes one already in that status, or
        switches another status to it. Status codes, names and the colours the printout and image
        use live in <Mono>ENTRY_STATUSES</Mono> in rotaExport.js (<Mono>solid</Mono> for tiles,{' '}
        <Mono>soft</Mono> for hourly boxes); the grid's own Tailwind classes are{' '}
        <Mono>STATUS_CLS</Mono> / <Mono>STATUS_SOFT</Mono> in rota.jsx, and the two must stay the
        same colours. Hourly cells open <Mono>PeriodEditor</Mono>, which validates overlap client-side
        with the same rule as the API (<Mono>periodProblem()</Mono>). Permissions come from{' '}
        <Mono>/me</Mono> via <Mono>useRotaPerms()</Mono>.
      </P>
      <P>
        Export: <Mono>components/staff/rotaExport.js</Mono>, no libraries.{' '}
        <Mono>buildRotaSheet()</Mono> turns the grid's current entries (the draft, flagged as such
        when unsaved) into the sheet the grid shows, without its buttons, roles and totals: a row
        per person (name only), the days across with the shifts under each day (the grid's own
        columns: active shifts plus any old one the week uses), and per cell an ON / status tile
        or OFF per shift (day parts), the periods in a tinted box with a status badge (hourly), or
        one hatched LEFT / AWAY tile for a day off the rota. <Mono>printRota()</Mono> writes{' '}
        <Mono>rotaHtml(sheet)</Mono> (A4 landscape <Mono>@page</Mono>) into a hidden{' '}
        <Mono>srcdoc</Mono> iframe and calls its <Mono>print()</Mono>, so the PDF comes from the
        browser's "Save as PDF". <Mono>saveRotaImage()</Mono> draws the same sheet on a 2x canvas
        (<Mono>drawRotaCanvas()</Mono>, white background, rounded tiles) and downloads a JPG
        (<Mono>image/jpeg</Mono>, quality 0.92), or on touch devices uses{' '}
        <Mono>navigator.share</Mono> with the file when <Mono>canShare</Mono> allows it.
      </P>
      <P>
        Closed days: <Mono>services/openDays.js</Mono> exports{' '}
        <Mono>resolveOpenDaysForWeek(tx, tenantId, venueId, dates)</Mono> (exception, then date
        override, then weekly template), shared by Cash Recon's week-detail and the rota's{' '}
        <Mono>GET .../weeks/:week</Mono> so both agree on which days are closed.{' '}
        <Mono>visibleRotaDates({'{'} week, entries, hideClosed {'}'})</Mono> in rotaExport.js drops
        dates not in <Mono>open_dates</Mono> unless an entry falls on them; <Mono>RotaGrid</Mono> calls
        it with <Mono>hide_closed_on_rota</Mono> and <Mono>buildRotaSheet()</Mono> with{' '}
        <Mono>hide_closed_on_print</Mono>. A closed day that stays visible is labelled Closed.
      </P>
      <P>
        Totals: the printout and image never have them (the Week column and the On shift row
        are on the grid only). Migration 194 dropped <Mono>rota_settings.hide_totals_on_print</Mono>{' '}
        (migration 114), the Rota setup switch that used to leave them out.
      </P>
      <H3>Modules, nav, dashboard</H3>
      <P>
        New module group <Mono>staff</Mono> ("Staff &amp; rota"): <Mono>staff</Mono>,{' '}
        <Mono>rota</Mono>, <Mono>rota_pay</Mono> and <Mono>rota_tips</Mono> (owner/admin only by
        default), <Mono>rota_dashboard</Mono>. Migration 118 split tips out of{' '}
        <Mono>rota_pay</Mono>: each role's <Mono>rota_tips</Mono> started equal to its{' '}
        <Mono>rota_pay</Mono>. Every pay-payload response goes through{' '}
        <Mono>redactWeek()</Mono> (<Mono>rota.js</Mono>), which uses{' '}
        <Mono>permissionLevel(req, key)</Mono> (<Mono>middleware/auth.js</Mono>, also behind{' '}
        <Mono>requirePermission</Mono> and the new <Mono>requireAnyPermission</Mono>) to drop row
        pay fields and <Mono>totals.pay</Mono> without <Mono>rota_pay</Mono>, or tip fields, tip
        totals, <Mono>pots</Mono> and <Mono>moves</Mono> without <Mono>rota_tips</Mono>, and adds{' '}
        <Mono>access: {'{'} pay, tips {'}'}</Mono>. <Mono>useRotaPerms()</Mono> exposes{' '}
        <Mono>canSeePay/canEditPay</Mono> and <Mono>canSeeTips/canEditTips</Mono>. The migration adds a "Staff" nav section after "Service"
        for tenants that already have a nav tree; the standard menu for new tenants and{' '}
        <Mono>ROUTE_CATALOG</Mono> have the five routes (since 22 Nov 2026 their page records in{' '}
        <Mono>shared/nav/rota.js</Mono>). The dashboard is a
        third <Mono>DashboardPage</Mono> config: <Mono>hs_dashboards.kind = 'rota'</Mono>,
        mounted at <Mono>/api/rota-dashboards</Mono>, widget types <Mono>rota_grid</Mono>,{' '}
        <Mono>rota_today</Mono>, <Mono>rota_week_pay</Mono>, <Mono>rota_tips</Mono>{' '}
        (CHECK constraint and <Mono>ROTA_WIDGET_TYPES</Mono>, now in{' '}
        <Mono>components/staff/rotaWidgets.jsx</Mono>; since migration 152 any dashboard
        can hold them, see Dashboards (shared widgets)). Navigation is the shared dashboard
        navigator. The
        tips widget has three widget options (<Mono>hs_dashboard_widgets.settings</Mono>):{' '}
        <Mono>hide_pots</Mono>, <Mono>hide_shares</Mono>, <Mono>hide_moves</Mono>, passed to{' '}
        <Mono>RotaTipsTable</Mono> as <Mono>sections</Mono> (the Rota page shows all three).
      </P>
      <H3>The rota on the phone (/mobile/rota)</H3>
      <P>
        <Mono>pages/mobile/MobileRota.jsx</Mono> (route in <Mono>routes/rota.jsx</Mono>, shell{' '}
        <Mono>mobile</Mono>; hub tile <Mono>rota</Mono> in <Mono>mobile/registry.js</Mono> with{' '}
        <Mono>module: 'rota'</Mono>). It reads <Mono>GET /api/rota/venues/:id/weeks/:week</Mono>{' '}
        through <Mono>useRotaWeek()</Mono> (query key <Mono>['rota-week', venue, week]</Mono>, the
        grid's), lists people from the week's <Mono>staff</Mono> (never <Mono>cash_staff</Mono>),
        honours <Mono>off_days</Mono> and <Mono>visibleRotaDates()</Mono>, and sums worked minutes
        (status <Mono>on</Mono> only) for display. Views: by day, by person, me (the person picked is
        kept per venue in <Mono>localStorage</Mono> <Mono>maca_rota_me:&lt;venue&gt;</Mono>,
        defaulting to a staff name equal to <Mono>/me</Mono>'s <Mono>full_name</Mono>: logins
        aren't linked to staff records). The view is kept in <Mono>maca_rota_view</Mono>, the venue
        in <Mono>maca_staff_venue</Mono> (the staff pages').
      </P>
      <P>
        With rota Manage (<Mono>useRotaPerms().canEditRota</Mono>) a person's day opens{' '}
        <Mono>DaySheet</Mono>: per shift Off / On / Sick / Holiday (<Mono>pto</Mono>) in day-parts
        mode, periods with <Mono>TimeSelect</Mono> and <Mono>periodProblem()</Mono> in hourly mode.
        Save calls <Mono>PUT .../weeks/:week/entries</Mono> with every entry of the week (both modes,
        so nothing made in the other mode is dropped), only that person's day in the current mode
        replaced, entries on off-rota days left out as the grid does, and no{' '}
        <Mono>removed_staff_ids</Mono> (who is off the week stays as it is). It then invalidates{' '}
        <Mono>rota-week</Mono> and <Mono>rota-pay</Mono>. No new route.
      </P>
    </section>
  )
}
