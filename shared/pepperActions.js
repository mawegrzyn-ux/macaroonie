// shared/pepperActions.js
//
// What Pepper did, in words: the changes its tools make (one row each in
// ai_actions) and the ways people reach it. Read by the Pepper page's
// Activity tab and by reports (pepper.actions, pepper.usage, pepper.chats),
// so both say the same thing. A new tool that changes something needs a
// line in ACTION_LABELS, or both show its raw name.

import { ASSISTANT_NAME } from './assistant.js'

/** Where a request or change came from: ai_usage.channel and ai_actions.channel. */
export const CHANNEL_LABELS = {
  staff_chat: ASSISTANT_NAME,
  staff_mcp: 'Staff AI app',
  guest_chat: 'Website chat',
  guest_mcp: 'Guest AI app',
}

/** What a model request was for (ai_requests.use, migration 271; USES in api/src/ai/context.js). */
export const USE_LABELS = {
  chat: ASSISTANT_NAME + '\'s chat',
  smart_builder: 'Report smart builder',
  menu_reader: 'Reading a menu',
  invoice_reader: 'Reading an invoice',
  receipt_reader: 'Reading a receipt',
  local_info: 'Local info',
  theme_maker: 'Theme maker',
  translation: 'Translating a menu',
  new_location: 'New location',
  rule_parser: 'Reading a rule',
  other: 'Something else',
}

/** What each tool that changes something did, by its name (ai_actions.tool). */
export const ACTION_LABELS = {
  create_booking: 'Made a booking', confirm_booking: 'Made a booking', change_booking: 'Moved a booking',
  cancel_booking: 'Cancelled a booking', set_booking_status: 'Changed status', update_guest_details: 'Updated guest details',
  add_booking_note: 'Added a note', request_booking_code: 'Emailed a booking code',
  log_temperature: 'Logged a fridge temperature', log_hold_check: 'Logged a hold temperature',
  log_cooking_check: 'Logged a cooking check', log_delivery: 'Logged a delivery',
  add_corrective_action: 'Added a corrective action', tick_checklist: 'Ticked a checklist',
  add_hs_action: 'Added an H&S action', complete_hs_action: 'Updated an H&S action',
  add_inventory_item: 'Added an inventory item', update_inventory_item: 'Changed an inventory item',
  add_supplier_price: 'Added a supplier price', update_supplier_price: 'Changed a supplier price',
  set_preferred_supplier: 'Chose a supplier', add_supplier: 'Added a supplier', update_supplier: 'Changed a supplier',
  create_order_list: 'Made an order list', update_order_list: 'Changed an order list', set_pars: 'Set pars',
  import_price_list: 'Imported a price list', switch_items: 'Switched inventory items off or on',
  update_prices_by_code: 'Updated prices by product code', update_order: 'Changed an order', place_order: 'Placed an order',
  import_supplier_basket: 'Brought a supplier\'s basket into an order',
  set_out_of_stock: 'Marked a supplier price out of stock or back in stock',
  request_order: 'Sent an order for approval', send_back_order: 'Sent an order back', split_order: 'Split an order',
  send_purchase_order: 'Sent a purchase order', change_purchase_order: 'Changed a purchase order',
  cancel_purchase_order: 'Cancelled a purchase order', receive_delivery: 'Booked in a delivery',
  create_menu: 'Made a menu', update_menu: 'Changed a menu', duplicate_menu: 'Copied a menu',
  add_dishes: 'Added dishes', update_dish: 'Changed a dish', remove_dishes: 'Removed dishes',
  update_section: 'Changed a menu section', remove_section: 'Removed a menu section', change_prices: 'Changed menu prices',
  publish_menu: 'Published a menu', cancel_menu_publish: 'Cancelled a menu publish',
  set_rota: 'Changed the rota', copy_rota_week: 'Copied a rota week', add_pay_adjustment: 'Added a pay adjustment',
  fill_wages_from_rota: 'Filled wages from the rota', adjust_tips: 'Moved or adjusted tips', set_tip_pot_amounts: 'Entered tip amounts',
  add_staff_member: 'Added a staff member', update_staff_member: 'Changed a staff member', set_staff_leaving: 'Set a leaving date',
  add_time_off: 'Took someone off the rota', remove_time_off: 'Removed time off the rota',
  record_cash_day: 'Entered Cash Recon figures', add_expense: 'Added an expense', submit_cash_day: 'Submitted a cash day', submit_cash_week: 'Submitted a cash week',
  mark_wages_paid: 'Marked wages paid', fill_cash_from_till: 'Filled Cash Recon from a till system',
  update_online_order: 'Moved an online order', refund_online_order: 'Refunded an online order',
  pause_online_orders: 'Paused or restarted online orders', set_sold_out: 'Changed sold out dishes',
  update_customer: 'Changed a customer', unsubscribe_customer: 'Unsubscribed a customer', anonymise_customer: 'Anonymised a customer',
  close_dates: 'Closed for dates', remove_closure: 'Removed a closure', update_booking_rules: 'Changed booking rules',
  publish_website: 'Published the website', set_website_banner: 'Changed the website banner', switch_promotion: 'Turned a promotion on or off',
  moderate_review: 'Changed a review', record_reviews: 'Recorded reviews', reload_screen: 'Reloaded a menu screen', report_issue: 'Logged an issue', request_feature: 'Requested a feature',
  make_rule: 'Made a rule', change_rule: 'Changed a rule', switch_rule: 'Switched a rule on or off', delete_rule: 'Deleted a rule',
  send_notice: 'Sent a notice', count_stock: 'Recorded a stock count',
  create_location: 'Created a new location',
  add_local_event: 'Added a local event', run_local_capture: 'Ran a local info capture',
  delete_local_info: 'Deleted local info entries',
  build_report: 'Saved a report', change_report: 'Changed a report', copy_report: 'Copied a report',
  delete_report: 'Deleted a report', share_report: 'Shared a report', export_report: 'Kept a report file',
  schedule_report: 'Scheduled a report', change_schedule: 'Changed a report schedule',
  pause_schedule: 'Paused or resumed a report schedule', send_report: 'Emailed a report',
  snooze_task: 'Snoozed a task', skip_task: 'Skipped a task', assign_task: 'Assigned a task',
}
