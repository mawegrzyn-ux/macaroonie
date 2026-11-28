# Macaroonie Office: Google Play store listing

What to put in the Play Console for `com.macaroonie.office` (Grow users ->
Store presence -> Main store listing, and the App content pages). The
graphics are in this folder; how they are made and taken again is in
`office-app/README.md` (Google Play -> The store listing and its graphics).

Counts are characters as Play counts them, checked with Python's `len()`
on the text between the fences. Everything is plain ASCII.

## App name

```text
Macaroonie Office
```

17 of 30 characters.

## Short description

```text
The staff app for Macaroonie venues: today's tasks, checks, stock and bookings
```

78 of 80 characters.

## Full description

```text
Macaroonie Office is the phone app for the staff of restaurants, cafes and takeaways that run on Macaroonie. It brings the day's work at your venue into one place: what needs doing now, what is late, and the forms to do it there and then.

You need a Macaroonie account to use the app. Your employer invites you, you sign in with that account, and you see what your role allows.

TODAY
One list for the day, worked out from your venue's own set-up: fridge and hold checks, checklists, deliveries to book in, the stock count, the cash-up and more, grouped as Late, Now, Next and Later. Checks open their form right there; other tasks open their page.

WHAT YOU CAN DO
- Log fridge, freezer, hot and cold hold and cooking checks, and tick off checklists
- Count stock area by area, in the units you count in, and scan a barcode to find an item
- Log waste with a reason and a photo
- Order from your lists, send orders and book deliveries in, with the barcode scanner
- See today's guests and tables, with their notes and allergies, and mark them arrived or seated
- See who is working today and this week, and your own shifts
- Do the cash-up, see the week's days at a glance and add petty cash expenses with a photo of the receipt
- Accept web orders, mark them ready and collected, pause ordering or mark dishes sold out
- Look up a dish's allergens, or find the dishes free from one
- Open your group's reports

PEPPER, THE ASSISTANT
Ask Pepper about bookings, the rota, the cash-up, orders, food safety and menus. Type, or hold the microphone and speak: your phone's own speech recognition turns what you say into words. A change Pepper suggests waits until you confirm it. Pepper is there when your group has switched it on for your role.

CAPTURE
Keep a photo, a picture from your phone, a voice note or a line for review later, such as an invoice, a delivery note or something that needs fixing. Share a picture from your gallery to Macaroonie Office and it opens in Capture.

NOTICES
Turn on notices for tasks that are due soon or late, for the venues and areas you choose, with quiet hours.

SHARED PHONES AND TABLETS
A phone or tablet can be shared by the team: each person says who they are with their PIN, so every check shows who did it.

Everything you do in the app is saved to your group's Macaroonie account, the same as in the Macaroonie office on a computer.

Privacy policy: https://macaroonie.com/privacy
```

2,424 of 4,000 characters.

## Graphics

| File | Pixels | Mode | Size | Play field |
|---|---|---|---|---|
| `icon-512.png` | 512 x 512 | RGBA, every pixel opaque | 24 KB | App icon (32-bit PNG) |
| `feature-graphic-1024x500.png` | 1024 x 500 | RGB | 316 KB | Feature graphic (24-bit PNG, under 1 MB) |
| `screenshots/01-hub.png` | 1080 x 1920 | RGB | 166 KB | Phone screenshot 1: the home screen, with Capture, the tiles and Pepper's bar |
| `screenshots/02-pepper.png` | 1080 x 1920 | RGB | 178 KB | Phone screenshot 2: Pepper, a fridge reading said aloud and its card to confirm |
| `screenshots/03-today.png` | 1080 x 1920 | RGB | 136 KB | Phone screenshot 3: Today, a late task and what to do now |
| `screenshots/04-fridge-check.png` | 1080 x 1920 | RGB | 119 KB | Phone screenshot 4: logging the evening fridge check |
| `screenshots/05-stock-count.png` | 1080 x 1920 | RGB | 121 KB | Phone screenshot 5: counting the walk-in, in boxes and grams |
| `screenshots/06-guest-list.png` | 1080 x 1920 | RGB | 159 KB | Phone screenshot 6: tonight's guests, with notes and an allergy |
| `screenshots/07-rota.png` | 1080 x 1920 | RGB | 160 KB | Phone screenshot 7: who is working today, a Saturday |

Upload the screenshots in that order (Play takes up to 8). The data in them
is invented: the group Harbour & Co, venues Quayside and West Pier, and
staff and guests named by a first name and an initial. Pepper's chat in
screenshot 2 is the real chat page and its real fridge check tool on that
data; only Pepper's own words were written for it (no AI model was called).
`make-assets.py` checks the sizes and modes again whenever it runs.

## Store settings

- **App or game**: App. **Category**: Business.
- **Tags**: pick the ones closest to restaurant management and staff tools
  from Play's list.
- **Contact email**: info@macaroonie.com
- **Website**: https://macaroonie.com
- **Privacy policy**: https://macaroonie.com/privacy
- **Price**: free (the app has no purchases; the business pays Macaroonie).
- **Ads**: the app contains no ads.

## Notes for the Play Console (the owner fills these in)

### App access

All of the app is behind a sign-in, so choose **All or some functionality
is restricted** and give Play's reviewers a way in:

- Make a demo account for the reviewers yourself: invite an email address
  you control to a demo group (invented data, like the screenshots' Harbour
  & Co, never a real business), with a role that sees the phone pages, and
  set a password for it in Auth0 so the reviewer doesn't need Google
  sign-in or an emailed code.
- Put the username and password only in the Play Console's App access form,
  never in this file, the repository or a chat.
- Keep the demo account and its password working for as long as the app is
  on Play: Play signs in with them again to review every update, and may
  check the live app at any time. An update whose review can't get past the
  sign-in is rejected. If the password ever changes, enter the new one in
  the App access form at the same time. Keep the demo group to invented data
  only.
- Instructions for the reviewer, for example: "Open the app and tap Sign
  in. The phone's browser opens the Macaroonie sign-in page: enter the email
  and password above. If you are asked to choose a business, pick the demo
  group. The home screen shows the venue's tiles; Today lists what needs
  doing. The microphone and camera are only used when you tap them."

### Data safety

Answer from the Privacy policy (https://macaroonie.com/privacy: section 5
for customers' staff, 7 for who data is shared with, 9 for how long it is
kept and 15 for what the app stores on the phone):

- **Collected**: name and email address (account management: from the
  employer's invitation and the sign-in, through Auth0); a device code for
  push notices, only when the person turns notices on (Device or other IDs);
  what the person asks Pepper, and the records they enter in the app such as
  checks, counts and cash-ups (App activity, Other user-generated content);
  the pages opened and the menu searches (App interactions, In-app search
  history), used to improve the service and suggest pages.
- **Photos**: only a photo or picture the person chooses to capture, attach
  or share to the app (Photos, optional).
- **Files and docs** (optional): files the person attaches to Pepper's chat,
  such as a PDF invoice or a CSV (the paperclip takes PDF, CSV, TSV, text,
  Markdown and JSON files as well as pictures), for app functionality. The
  Privacy policy's section 5 lists them ("any files you attach").
- **Audio**: none. The phone's own speech recognition turns speech into
  words; only the words reach Macaroonie, and no audio is kept. Say so if
  the form asks about voice.
- **Shared with third parties**: no; the providers that run the service for
  Macaroonie (sign-in, hosting, notices, the AI model behind Pepper) are
  service providers, which Play doesn't count as sharing.
- **Security**: all data is encrypted in transit (HTTPS).
- **Deletion**: accounts are made by the employer, not in the app; a person
  can ask their employer, or info@macaroonie.com, to delete their account
  and data. Play also asks for a web address where people can ask for their
  account to be deleted, and that page must name the app (or Macaroonie) and
  show the steps prominently. The Privacy policy is long and has no section
  that does this, so it probably won't pass. Make a short page first (for
  example macaroonie.com/delete-account) that says: ask your employer to
  delete your account, or email info@macaroonie.com from the address you
  sign in with; what is deleted (the account, and the sign-in with Auth0
  when you ask); and what the business may keep and for how long (the
  Privacy policy's section 9). Then give that page's address.
- **Ads and tracking**: none; nothing is used for advertising.

### Content rating

Fill in the questionnaire as a business tool: no violence, sexual content,
bad language, drugs or gambling; no purchases.

Users can send each other text in the app: someone with Manage on Pepper
(a manager) can ask Pepper to send a notice they word (a title and a short
message) to the phones of a teammate or of everyone with a role (Pepper's
send_notice, shown on a card to confirm first), and the records people
enter (checks, counts, notes on bookings) are seen by their colleagues. So
answer **yes** to the question on users interacting or exchanging content,
and describe it as private messages and records between the staff of one
business, who the employer invites and controls: nothing is shared
publicly, there are no public profiles and no chat with strangers, and the
app doesn't share the person's location. Pepper writes answers with an AI
model for the business's own staff; answer Play's question on AI-generated
content accordingly. The rating that should come out is still the lowest
for each region (Everyone, PEGI 3), with Users Interact listed beside it,
but it is whatever the questionnaire gives.

### Target audience and content

- **Target age**: 18 and over only. The app is for the staff of businesses
  that use Macaroonie and needs an account the employer invites; it is not
  made for children and has no part aimed at them (the Privacy policy's
  section 14). Employers may have young workers of 16 or 17; if they should
  be named too, add that band, and read Play's notes on it first. Never
  choose an age under 13: that brings in Play's Families policy.
- **Appeals to children**: no.
- **News app**: no. **Government app**: no. **Financial features**: none.
  **Health**: none.
- **Permissions to explain if Play asks**: the camera (scanning barcodes and
  taking a photo when the person taps it), the microphone (Pepper, only
  while the person holds or taps the microphone) and notifications (the task
  notices the person turns on).
