// shared/registry/files.js: every area's file of the object registry,
// imported by name (docs/PEPPER_FIRST.md 13, decision 5; Pepper-first step 8).
//
// index.js gathers from this list instead of reading the folder: shared/ is
// plain ESM loaded by Node (the API) and by Vite (the admin), only Node can
// read a folder and only Vite has import.meta.glob, and a folder read needs a
// top-level await that can deadlock two modules waiting for each other. A new
// area's file is added here once; its records stay in its own file.
// shared/test/registry.test.mjs fails when a file in this folder is left out.

import * as bookings from './bookings.js'
import * as cash from './cash.js'
import * as core from './core.js'
import * as hs from './hs.js'
import * as hub from './hub.js'
import * as kiosk from './kiosk.js'
import * as kitchen from './kitchen.js'
import * as localInfo from './local-info.js'
import * as loyalty from './loyalty.js'
import * as menus from './menus.js'
import * as ordering from './ordering.js'
import * as pepper from './pepper.js'
import * as purchasing from './purchasing.js'
import * as reports from './reports.js'
import * as rota from './rota.js'
import * as screens from './screens.js'
import * as shell from './shell.js'
import * as till from './till.js'
import * as website from './website.js'

export const FILES = [
  ['bookings', bookings],
  ['cash', cash],
  ['core', core],
  ['hs', hs],
  ['hub', hub],
  ['kiosk', kiosk],
  ['kitchen', kitchen],
  ['local-info', localInfo],
  ['loyalty', loyalty],
  ['menus', menus],
  ['ordering', ordering],
  ['pepper', pepper],
  ['purchasing', purchasing],
  ['reports', reports],
  ['rota', rota],
  ['screens', screens],
  ['shell', shell],
  ['till', till],
  ['website', website],
]
