// shared/pos/permissions.js
//
// What a POS role lets a person do on the till. ONE list, used by the
// check rules (shared/pos/checks.js, so the till and the sequencer refuse
// the same things), the till's buttons and the admin role editor.
//
// A role (pos_roles.permissions):
//   { void: bool, refund: bool, discount_max_pct: 0-100, comp: bool,
//     open_drawer: bool, reopen: bool, take_over: bool, price_override: bool,
//     transfer: bool, sold_out: bool, reports: bool, close_day: bool, manager: bool }
//
// Something a person's role doesn't allow can still be done with a manager's
// approval: a person whose role allows it types their PIN, and the event
// carries `approved_by` (their staff id). `manager` means "may approve".

export const POS_PERMISSIONS = [
  { key: 'void',           label: 'Void sent items',         hint: 'Take back an item the kitchen already has.' },
  { key: 'refund',         label: 'Refund',                  hint: 'Give money back on a closed check.' },
  { key: 'comp',           label: 'Comp items',              hint: 'Give an item free (100% off), with a reason.' },
  { key: 'open_drawer',    label: 'Open the drawer',         hint: 'No sale: open the cash drawer without a payment.' },
  { key: 'reopen',         label: 'Reopen checks',           hint: 'Open a closed check again.' },
  { key: 'take_over',      label: 'Take over checks',        hint: 'Work on and transfer other people\'s checks.' },
  { key: 'price_override', label: 'Change prices',           hint: 'Type a different price for an item.' },
  { key: 'transfer',       label: 'Move items between checks', hint: 'Split checks, merge checks and move items.' },
  { key: 'sold_out',       label: 'Mark dishes sold out',    hint: 'Hold a dish down to mark it sold out (till, website, online orders and screens).' },
  { key: 'reports',        label: 'See reports',             hint: 'X report and today\'s figures on the till.' },
  { key: 'close_day',      label: 'Close the day',           hint: 'Run the Z report and end the trading day.' },
  { key: 'manager',        label: 'Approve for others',      hint: 'Type their PIN to allow what someone else\'s role doesn\'t.' },
]

export const PERMISSION_KEYS = POS_PERMISSIONS.map(p => p.key)

/** Default roles for a new tenant (migration 156 and POST /api/pos/roles/defaults). */
export const DEFAULT_POS_ROLES = [
  { name: 'Server', permissions: { discount_max_pct: 0, transfer: true } },
  {
    name: 'Supervisor',
    permissions: {
      void: true, comp: true, discount_max_pct: 25, open_drawer: true, reopen: true,
      take_over: true, transfer: true, sold_out: true, reports: true, manager: true,
    },
  },
  {
    name: 'Manager',
    permissions: {
      void: true, refund: true, comp: true, discount_max_pct: 100, open_drawer: true, reopen: true,
      take_over: true, price_override: true, transfer: true, sold_out: true, reports: true, close_day: true, manager: true,
    },
  },
]

/** A role's permissions with every key present. */
export function normalisePermissions(p = {}) {
  const out = {}
  for (const key of PERMISSION_KEYS) out[key] = !!p[key]
  const pct = Number(p.discount_max_pct)
  out.discount_max_pct = Number.isFinite(pct) ? Math.max(0, Math.min(100, Math.round(pct))) : 0
  return out
}

/**
 * Does `staff` (a { id, permissions } from the config) have `key`?
 * For 'discount' pass the percent as `amount`.
 */
export function has(staff, key, amount = null) {
  if (!staff || staff.is_active === false) return false
  const p = staff.permissions || {}
  if (key === 'discount') return (Number(p.discount_max_pct) || 0) >= (Number(amount) || 0)
  return !!p[key]
}

// What a venue can make need a manager every time, whatever the person's
// role allows (pos_settings.approvals, migration 224; Store tech > Receipts
// and payments). With a switch on, someone whose role has Approve for others
// (and the action's own permission, where it has one) does it themselves or
// types their PIN for whoever does.
export const MANAGER_ACTIONS = [
  { key: 'delete_unsent', permission: null,     label: 'Taking off items not sent yet', hint: 'Deleting an item before it goes to the kitchen, or lowering its quantity.' },
  { key: 'void_sent',     permission: 'void',   label: 'Voiding items the kitchen has', hint: 'Taking back an item already sent (a VOID ticket goes to the kitchen).' },
  { key: 'cancel_order',  permission: null,     label: 'Cancelling a whole order',      hint: 'The order\'s Cancel order button.' },
  { key: 'refund',        permission: 'refund', label: 'Refunds',                       hint: 'Giving money back on a closed check.' },
  // Migration 225 (shared/pos/charges.js, discounts.js).
  { key: 'remove_charge', permission: null,     label: 'Taking an optional charge off', hint: 'Like the service charge. Charges that aren\'t optional always need a manager.' },
  { key: 'custom_discount', permission: null,   label: 'Discounts typed in on the till', hint: 'A discount that isn\'t one of the Discounts set up in Store tech (those say themselves whether they need a manager).' },
]
export const MANAGER_ACTION_KEYS = MANAGER_ACTIONS.map(a => a.key)
// Not a switch: something that needs a manager every time whatever the venue
// set (a discount from the list marked so, a charge that isn't optional).
export const MANAGER_ALWAYS = 'always'

/** The venue's switches with every key present (all off by default). */
export function normaliseApprovals(a = {}) {
  const out = {}
  for (const key of MANAGER_ACTION_KEYS) out[key] = !!(a && a[key])
  return out
}

/**
 * With the venue's switch on for `action` (settings.approvals), a manager
 * must allow it: the person themselves when they may approve, else the
 * event's approver. Returns null when allowed, else a reason.
 */
export function managerProblem(staffById, event, action, settings) {
  if (action === MANAGER_ALWAYS) return approverProblem(staffById, event)
  if (!settings?.approvals?.[action]) return null
  const def = MANAGER_ACTIONS.find(a => a.key === action)
  return approverProblem(staffById, event, def?.permission || null)
}

/**
 * A manager must allow it: the person themselves when they may approve (and
 * have `permission`, when one is named), else the event's approver. Returns
 * null when allowed, else a reason.
 */
export function approverProblem(staffById, event, permission = null) {
  const ok = s => !!s && has(s, 'manager') && (!permission || has(s, permission))
  if (ok(staffById[event.staff_id])) return null
  if (event.approved_by) return ok(staffById[event.approved_by]) ? null : 'The approver isn\'t allowed to do this'
  return 'Needs a manager'
}

/**
 * May the event's person do `key`, themselves or with the approver's PIN?
 * staffById: { [id]: { id, name, permissions, is_active } }.
 * Returns null when allowed, else a reason.
 */
export function permissionProblem(staffById, event, key, amount = null) {
  const who = staffById[event.staff_id]
  if (!who) return 'Unknown staff member'
  if (has(who, key, amount)) return null
  if (event.approved_by) {
    const approver = staffById[event.approved_by]
    if (approver && has(approver, 'manager') && has(approver, key, amount)) return null
    return 'The approver isn\'t allowed to do this'
  }
  return 'Needs a manager'
}
