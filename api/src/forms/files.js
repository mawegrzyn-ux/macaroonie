// src/forms/files.js
//
// Every area's file of plain forms (src/forms/plain.js, Pepper-first step
// 8A3), imported by name. index.js gathers from this list instead of reading
// the folder: a folder read needs a top-level await, and two modules that
// each wait for the other while they load never finish. A new area's file is
// added here once; its forms stay in its own file. pepper-plain-forms.test.mjs
// fails when a file in this folder is left out.

import * as bookings from './bookings.js'
import * as cash from './cash.js'
import * as purchasing from './purchasing.js'
import * as recipes from './recipes.js'
import * as rota from './rota.js'

export const FILES = [
  ['bookings', bookings],
  ['cash', cash],
  ['purchasing', purchasing],
  ['recipes', recipes],
  ['rota', rota],
]
