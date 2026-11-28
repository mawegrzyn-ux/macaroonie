# Outstanding: screens

What is not built, known limits and follow-ups in this area (`docs/claude/areas/screens.md`). Item numbers are the old CLAUDE.md numbering, kept so earlier references still work; a new item takes the next number after the highest in any file of this folder. Check the live code before calling anything here pending.

**22. Menu screens — follow-ups** *(shipped with migration 166)*
- Walls and synced playback tested with two Chromium windows on one machine only. On real screens: check the bezel gap looks right, and that the boards change together (the clock is set to within a round trip; a screen with a slow connection can be a few tens of ms out).
- Videos: MP4 (H.264) is the safe choice; WebM / VP9 depends on the device. A video block always starts muted; sound only plays where the device allows it (Fully Kiosk: allow autoplay with sound). A video can't be longer than the board's time in a playlist without being cut (use Video length). No transcoding or resizing: a 4K video on a weak TV box may stutter.
- The video cache keeps every video the screen's boards use; there is no size limit, so many large videos can fill a small device. Videos are downloaded one at a time after a change.
- Dropping files: up to 10 at a time; the website canvas only replaces pictures on Image, Hero and Story blocks (other blocks get an Image block after them); dropping onto the Gallery block doesn't add to it. Not tried with a real OS drag on an iPad (the tests dispatch DragEvents with real files).
- Not tried on a real Android TV box, a TV's own Chrome, or Fully Kiosk yet (install, full screen, wake lock, a portrait screen turned by `rotation`, memory over days). First real use: leave a screen running for a day and check the admin's last seen / showing.
- Google Fonts are fetched by each screen (cached by the service worker after the first load); a screen that first starts offline shows fallback fonts until it has been online once.
- A playlist with nothing on now shows black; there is no "fallback board" setting.
- Times can't run overnight (22:00 to 02:00): split them into two times (22:00-23:59 and 00:00-02:00).
- Board images and dish photos come from wherever they are stored (relative `/uploads/...` on the screens host, or S3 URLs); a very large photo is shown as is (no resizing for screens).
- The designer has no undo; Discard is reloading the page without saving.
- Sold out from the till needs the till to be online (it isn't an event in the till's outbox).
- Order ready boards that show only some orders (migration 237) filter on the screen, from the venue's whole feed (40 numbers a column): at a very busy venue a filtered board can miss orders beyond those 40. Filters are by order type and revenue stream name only (not by till, kiosk, dish or section); GloriaFood orders have no stream; orders already in the kitchen when it shipped have no stream either. Not tried on a real screen (the renderer is shared with the designer and unit tested; the designer was tried in Chromium).

**85. Menu screens: what the Store status block (28 Nov 2026) left for later** *(shipped 28 Nov 2026, no migration; the Tech board itself is item 84)*
- **Cloud only**: the block reads `GET /screen-api/tech` from the cloud every 45 s; with the internet down it keeps the last answer (its "seen X min ago" keeps counting) and the venue hub doesn't serve it, unlike order numbers. Nothing is pushed: a till that drops off shows on the next read.
- **The live kitchen view leaves it out** (`{ hidden: true }`): a board with both an Order status block and a Store status block shows only the orders there.
- **Room for the strip and the key is an estimate** (`linesFor()`): very long kit names or a narrow block can still push the key's last line out of the block; make the block taller, the words smaller or turn the key off. The group names take the board's heading font, the rest the body font; the states' colours can't be changed.
- **Who sees it is up to the person who places it**: the block names the kit, so it is meant for staff screens; a screen only gets the kit when one of its boards has the block, but nothing stops that board being on a screen guests see. There is no PIN or hiding by time of day.
- Tried in the player in Chromium at 1920 x 1080 and in the designer at 1280 px, not on a real TV, Fully Kiosk Browser or the Android app.

