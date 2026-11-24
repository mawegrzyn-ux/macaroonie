// src/ai/tools/files.js
//
// Every staff tool file, imported by name. index.js gathers from this list
// instead of reading the folder at start-up: a folder read needs a
// top-level await, and two modules that each wait for the other while they
// load never finish (the report tools import the catalogue, which the app
// loads too). A new area's tool file is added here once; its tools, order,
// areas and prompt lines stay in its own file. pepper-tools-registry.test.mjs
// fails if one is left out.

import * as briefing_ from './briefing.js'
import * as cash_ from './cash.js'
import * as forms_ from './forms.js'
import * as general_ from './general.js'
import * as hs_ from './hs.js'
import * as localInfo_ from './localInfo.js'
import * as locations_ from './locations.js'
import * as menus_ from './menus.js'
import * as orders_ from './orders.js'
import * as purchasing_ from './purchasing.js'
import * as reportSchedules_ from './reportSchedules.js'
import * as reports_ from './reports.js'
import * as rota_ from './rota.js'
import * as rules_ from './rules.js'
import * as site_ from './site.js'
import * as staff_ from './staff.js'
import * as today_ from './today.js'
import * as venue_ from './venue.js'

export const FILES = [
  ['briefing.js', briefing_],
  ['cash.js', cash_],
  ['forms.js', forms_],
  ['general.js', general_],
  ['hs.js', hs_],
  ['localInfo.js', localInfo_],
  ['locations.js', locations_],
  ['menus.js', menus_],
  ['orders.js', orders_],
  ['purchasing.js', purchasing_],
  ['reportSchedules.js', reportSchedules_],
  ['reports.js', reports_],
  ['rota.js', rota_],
  ['rules.js', rules_],
  ['site.js', site_],
  ['staff.js', staff_],
  ['today.js', today_],
  ['venue.js', venue_],
]
