# Links that open a page at a venue, a day or a week, and a tab

- Timeline and Bookings open at the venue and day a link names, the Rota at a venue and week, Food safety and Online orders at a venue, day and tab, and Cash recon at a venue and a day, a week or the week's wages (`/rota?venue=<id>&week=2026-11-23`).
- The page opens there once; its own venue picker, day and week buttons and tabs then work as usual, and a reload doesn't go back to the link's day. A venue you can't see, or a day that doesn't exist, is ignored.
- Each page's record in the menu's page list says what its address accepts, and one rule builds and reads such links (`shared/nav/links.js`, `useDeepLink()`).
