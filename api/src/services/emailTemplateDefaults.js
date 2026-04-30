// src/services/emailTemplateDefaults.js
//
// Default HTML email templates used when a tenant hasn't customised
// their own. Clean, professional, mobile-responsive.
//
// Every template uses {{merge_fields}} from emailSvc.MERGE_FIELDS.
// The manage_link field is the most important — it's the guest's
// single-click access to view/modify/cancel their booking.

const WRAPPER_START = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <style>
    body { margin:0; padding:0; background:#f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .outer { max-width:600px; margin:0 auto; padding:24px 16px; }
    .card { background:#ffffff; border-radius:8px; padding:32px 28px; }
    h1 { font-size:22px; margin:0 0 6px; color:#1a1a1a; }
    .sub { color:#666; font-size:14px; margin:0 0 24px; }
    table.details { width:100%; border-collapse:collapse; margin:20px 0; }
    table.details td { padding:8px 0; font-size:15px; border-bottom:1px solid #f0f0f0; }
    table.details td:first-child { color:#888; width:120px; }
    table.details td:last-child { color:#1a1a1a; font-weight:500; }
    .btn { display:inline-block; padding:14px 28px; background:#630812; color:#ffffff; text-decoration:none; border-radius:6px; font-weight:600; font-size:15px; }
    .btn-outline { background:transparent; color:#630812; border:2px solid #630812; }
    .footer { text-align:center; padding:24px 0 0; font-size:12px; color:#999; }
    .footer a { color:#888; }
  </style>
</head>
<body>
<div class="outer">
<div class="card">
`

const WRAPPER_END = `
</div>
<div class="footer">
  <p>{{venue_name}} &middot; {{venue_address}}</p>
  <p>{{venue_phone}} &middot; {{venue_email}}</p>
</div>
</div>
</body>
</html>
`

const DETAILS_TABLE = `
<table class="details">
  <tr><td>Date</td><td>{{booking_date}}</td></tr>
  <tr><td>Time</td><td>{{booking_time}} &ndash; {{booking_end_time}}</td></tr>
  <tr><td>Guests</td><td>{{covers}}</td></tr>
  <tr><td>Reference</td><td>{{booking_reference}}</td></tr>
</table>
`

const MANAGE_BUTTONS = `
<div style="text-align:center; margin:28px 0 8px;">
  <a href="{{manage_link}}" class="btn">View or manage your booking</a>
</div>
<p style="text-align:center; font-size:13px; color:#888; margin:8px 0 0;">
  Need to change the date, time, or number of guests? Use the link above.
</p>
`

export const DEFAULT_TEMPLATES = {
  confirmation: {
    subject: 'Booking confirmed at {{venue_name}}',
    body_html: `${WRAPPER_START}
<h1>You're booked, {{guest_name}}!</h1>
<p class="sub">Your table at {{venue_name}} is confirmed.</p>
${DETAILS_TABLE}
${MANAGE_BUTTONS}
${WRAPPER_END}`,
  },

  reminder: {
    subject: 'Reminder: your booking at {{venue_name}} is coming up',
    body_html: `${WRAPPER_START}
<h1>See you soon, {{guest_name}}</h1>
<p class="sub">Just a reminder that your booking is coming up.</p>
${DETAILS_TABLE}
<div style="text-align:center; margin:28px 0 8px;">
  <a href="{{manage_link}}" class="btn">View your booking</a>
</div>
<p style="text-align:center; font-size:13px; color:#888; margin:8px 0 0;">
  Can't make it? Please let us know as soon as possible so we can offer the table to another guest.
</p>
${WRAPPER_END}`,
  },

  modification: {
    subject: 'Booking updated at {{venue_name}}',
    body_html: `${WRAPPER_START}
<h1>Booking updated, {{guest_name}}</h1>
<p class="sub">Your booking at {{venue_name}} has been changed. Here are the new details:</p>
${DETAILS_TABLE}
${MANAGE_BUTTONS}
${WRAPPER_END}`,
  },

  cancellation: {
    subject: 'Booking cancelled at {{venue_name}}',
    body_html: `${WRAPPER_START}
<h1>Booking cancelled</h1>
<p class="sub">Hi {{guest_name}}, your booking at {{venue_name}} has been cancelled.</p>
${DETAILS_TABLE}
<p style="color:#666; font-size:14px; margin:24px 0 0;">
  Changed your mind? You can always book a new table at any time.
</p>
${WRAPPER_END}`,
  },
}
