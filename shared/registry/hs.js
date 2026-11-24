// shared/registry/hs.js: the Health & safety area's business objects
// (shared/registry/index.js says what a record holds).

const DAY = { page: '/food-safety', with: ['venue', 'date', 'tab'] }

export const objects = [
  {
    key: 'safety.fridges', label: 'Fridge or freezer', plural: 'Fridges and freezers', words: ['fridge', 'freezer', 'walk-in', 'chiller'],
    table: 'fs_equipment', subjects: ['safety.fridges'],
    page: '/food-safety',
  },
  {
    key: 'safety.fridge_checks', label: 'Temperature reading', plural: 'Temperature readings',
    words: ['fridge temperature', 'fridge check', 'fridge temps', 'freezer reading'],
    table: 'fs_temp_logs', subjects: ['safety.fridge_checks'],
    page: '/food-safety', open: DAY,
    actions: ['log_temperature', 'add_corrective_action'],
    forms: ['temps', 'corrective'],
  },
  {
    key: 'safety.hold_stations', label: 'Hold station', plural: 'Hold stations', words: ['hot hold', 'cold hold', 'bain marie'],
    table: 'fs_hold_stations', subjects: ['safety.hold_stations'],
    page: '/food-safety',
  },
  {
    key: 'safety.hold_checks', label: 'Hold check', plural: 'Hold checks', words: ['hot hold check', 'cold hold check', 'hold temperature'],
    table: 'fs_hold_checks', subjects: ['safety.hold_checks'],
    page: '/food-safety', open: DAY,
    actions: ['log_hold_check', 'add_corrective_action'],
    forms: ['holds', 'corrective'],
  },
  {
    key: 'safety.cooking_checks', label: 'Cooking check', plural: 'Cooking checks', words: ['core temperature', 'probe check'],
    table: 'fs_cooking_checks', subjects: ['safety.cooking_checks', 'safety.cooking_sessions', 'safety.cooking_items'],
    page: '/food-safety', open: DAY,
    actions: ['log_cooking_check', 'add_corrective_action'],
    forms: ['cooking', 'corrective'],
  },
  {
    key: 'safety.delivery_checks', label: 'Delivery check', plural: 'Delivery checks', words: ['goods in', 'delivery temperature'],
    table: 'fs_delivery_checks', subjects: ['safety.delivery_checks'],
    page: '/food-safety', open: DAY,
    actions: ['log_delivery'],
    forms: ['delivery'],
  },
  {
    key: 'safety.checklist_templates', label: 'Checklist', plural: 'Checklists', words: ['opening checklist', 'closing checklist'],
    table: 'checklist_templates', subjects: ['safety.checklist_templates', 'safety.checklist_tasks'],
    page: '/checklists',
  },
  {
    key: 'safety.checklists', label: 'Checklist done', plural: 'Checklists done', words: ['checklist tick', 'ticked checklist'],
    table: 'checklist_instances', subjects: ['safety.checklists', 'safety.checklist_ticks'],
    page: '/checklists',
    actions: ['tick_checklist'],
    forms: ['checklist'],
  },
  {
    key: 'safety.actions', label: 'H&S action', plural: 'H&S actions', words: ['action log', 'health and safety action', 'hs action'],
    table: 'hs_action_log', subjects: ['safety.actions', 'safety.action_categories'],
    page: '/hs-action-log',
    actions: ['add_hs_action', 'complete_hs_action'],
    forms: ['hs_action'],
  },
]

export const notObjects = {
  'A day of food safety and checklists, worked out from the checks themselves: nothing to change of its own.': ['safety.days'],
}
