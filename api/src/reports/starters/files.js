// src/reports/starters/files.js
//
// Every file of this folder that exports `starters`, imported by name. The
// index and decisions gather from this list (gather.js) instead of reading
// the folder at start-up: a folder read needs a top-level await, and two
// modules that each wait for the other while they load never finish (the
// report tools import the catalogue, and Pepper's tool list imports the
// report tools). A new area's file is added here once; its subjects and
// order stay in its own file. The catalogue test fails if one is left out.

import * as app from './app.js'
import * as bookings from './bookings.js'
import * as cash from './cash.js'
import * as guests from './guests.js'
import * as kiosks from './kiosks.js'
import * as kitchen from './kitchen.js'
import * as local from './local.js'
import * as loyalty from './loyalty.js'
import * as menus from './menus.js'
import * as online from './online.js'
import * as purchasing from './purchasing.js'
import * as recipes from './recipes.js'
import * as safety from './safety.js'
import * as staff from './staff.js'
import * as tech from './tech.js'
import * as till from './till.js'

export const FILES = [
  ['app.js', app],
  ['bookings.js', bookings],
  ['cash.js', cash],
  ['guests.js', guests],
  ['kiosks.js', kiosks],
  ['kitchen.js', kitchen],
  ['local.js', local],
  ['loyalty.js', loyalty],
  ['menus.js', menus],
  ['online.js', online],
  ['purchasing.js', purchasing],
  ['recipes.js', recipes],
  ['safety.js', safety],
  ['staff.js', staff],
  ['tech.js', tech],
  ['till.js', till],
]
