// src/reports/catalogue/screens.js
//
// Menu screens (docs/REPORTS.md 20, phase 3d): the screens on the Menu
// screens page, the boards, playlists and walls they show. As those pages
// show them: what a screen shows is its wall's board or playlist when it is
// in a wall, else its own, a playlist before a board (routes/screens.js
// screenView()); online means it talked to us in the last two and a half
// minutes (ONLINE_MS there).
//
// Whether a screen is linked to a device now can't be reported: that is its
// device's key, which reports never read. "Last linked" is when a code last
// linked one.

import { subject, text, number, yesno, choice, moment, count, one, many } from './define.js'

const ROTATIONS = { 0: 'Upright', 90: 'Turned right', 180: 'Upside down', 270: 'Turned left' }
const FITS = { contain: 'Fit (bars if the shape differs)', cover: 'Fill (crop the edges)', stretch: 'Stretch' }

// Seconds since a screen last talked to us that still count as online.
const ONLINE = "({t}.last_seen_at > now() - interval '150 seconds')"

// What a row (a screen or a wall) shows of its own: a playlist before a board.
const showsKind = (p, d) => `(CASE WHEN ${p} IS NOT NULL THEN 'playlist' WHEN ${d} IS NOT NULL THEN 'board' END)`
const showsName = (p, d) => `(CASE WHEN ${p} IS NOT NULL THEN (SELECT x.name FROM screen_playlists x WHERE x.id = ${p} AND x.tenant_id = {t}.tenant_id)
   WHEN ${d} IS NOT NULL THEN (SELECT x.name FROM screen_designs x WHERE x.id = ${d} AND x.tenant_id = {t}.tenant_id) END)`

// A screen in a wall shows the wall's; its own board or playlist waits.
const WALL = (col) => `(SELECT w.${col} FROM screen_walls w WHERE w.id = {t}.wall_id AND w.tenant_id = {t}.tenant_id)`
const inWall = '({t}.wall_id IS NOT NULL)'
const effective = col => `(CASE WHEN ${inWall} THEN ${WALL(col)} ELSE {t}.${col} END)`

const SHOWS = { playlist: 'A playlist', board: 'A board' }

export default [
  subject({
    key: 'screens.screens',
    label: 'Menu screens',
    one: 'menu screen',
    area: 'tech',
    module: 'screens',
    about: 'The menu screens on the Menu screens page (menu boards and order ready boards): what each shows and when it last talked to us. A screen in a wall shows the wall\'s board or playlist.',
    from: 'screens',
    name: 'name',
    venue: 'venue_id',
    fields: {
      name: text('name'),
      code: text('short_code', { label: 'ID', about: 'The short code the Menu screens page shows (S1).' }),
      shows_kind: choice({ sql: showsKind(effective('playlist_id'), effective('design_id')) }, SHOWS, { label: 'Shows a', empty: 'Nothing' }),
      shows: text({ sql: showsName(effective('playlist_id'), effective('design_id')) }, { label: 'Shows', empty: 'Nothing', about: 'The board or playlist on it now: its wall\'s when it is in a wall.' }),
      in_wall: yesno({ sql: inWall }, { label: 'In a wall' }),
      wall_place: text({ sql: "(CASE WHEN {t}.wall_id IS NOT NULL THEN 'Column ' || ({t}.wall_col + 1) || ', row ' || ({t}.wall_row + 1) END)" }, { label: 'Place in the wall' }),
      online: yesno({ sql: ONLINE }, { label: 'Online now', about: 'It talked to us in the last two and a half minutes, as on the Menu screens page.' }),
      last_seen_at: moment('last_seen_at', { label: 'Last seen' }),
      linked_at: moment('paired_at', { label: 'Last linked', about: 'When a code last linked a device to it. A screen disconnected since keeps the time.' }),
      app_version: text('app_version', { label: 'Player version' }),
      width: number('width', { label: 'Width (px)', decimals: 0 }),
      height: number('height', { label: 'Height (px)', decimals: 0 }),
      mounted: choice({ sql: '({t}.rotation::text)' }, ROTATIONS, { label: 'Mounted' }),
      fit: choice('fit', FITS, { label: 'When the board\'s shape differs' }),
      added_at: moment('created_at', { label: 'Added' }),
    },
    measures: {
      screens: count({ label: 'Menu screens' }),
      online_now: count({ label: 'Online now', where: ONLINE, about: 'Screens that talked to us in the last two and a half minutes.' }),
      in_walls: count({ label: 'In a wall', where: inWall }),
      showing_nothing: count({ label: 'Showing nothing', where: `(${showsKind(effective('playlist_id'), effective('design_id'))} IS NULL)`, about: 'Screens with no board or playlist (their wall\'s, when in a wall).' }),
    },
    links: {
      wall: one('screens.walls', 'wall_id', { label: 'Wall' }),
      board: one('screens.boards', 'design_id', { label: 'Its own board', about: 'The board it shows when it isn\'t in a wall.' }),
      playlist: one('screens.playlists', 'playlist_id', { label: 'Its own playlist', about: 'The playlist it shows when it isn\'t in a wall.' }),
    },
    list: ['name', 'code', 'venue.name', 'shows', 'online', 'last_seen_at'],
    sort: [{ by: 'name', dir: 'asc' }],
    // Its device's key, what the device last reported about itself, and its
    // place on the page.
    skip: ['secret_hash', 'device_info', 'status', 'sort_order', 'updated_at'],
  }),

  subject({
    key: 'screens.boards',
    label: 'Screen boards',
    one: 'board',
    area: 'tech',
    module: 'screens',
    about: 'The boards made in the Screen board designer, shared by every location.',
    from: 'screen_designs',
    name: 'name',
    open: { page: '/screens/boards/:id', module: 'screens' },
    fields: {
      name: text('name'),
      width: number('width', { label: 'Width (px)', decimals: 0 }),
      height: number('height', { label: 'Height (px)', decimals: 0 }),
      blocks: number({ sql: "(CASE WHEN jsonb_typeof({t}.layout->'blocks') = 'array' THEN jsonb_array_length({t}.layout->'blocks') ELSE 0 END)" }, { label: 'Blocks', decimals: 0 }),
      made_by: text('created_by', { label: 'Made by', pii: true }),
      changed_by: text('updated_by', { label: 'Last changed by', pii: true }),
      made_at: moment('created_at', { label: 'Made' }),
      changed_at: moment('updated_at', { label: 'Last changed' }),
    },
    measures: {
      boards: count({ label: 'Boards' }),
    },
    links: {
      screens: many('screens.screens', 'design_id', { label: 'Screens with it as their own' }),
      walls: many('screens.walls', 'design_id', { label: 'Walls showing it' }),
    },
    list: ['name', 'width', 'height', 'changed_at', 'changed_by'],
    sort: [{ by: 'name', dir: 'asc' }],
  }),

  subject({
    key: 'screens.playlists',
    label: 'Screen playlists',
    one: 'playlist',
    area: 'tech',
    module: 'screens',
    about: 'The playlists on the Screen playlists page: boards that take turns, each for some seconds.',
    from: 'screen_playlists',
    name: 'name',
    fields: {
      name: text('name'),
      boards: number({ sql: '(SELECT count(*) FROM screen_playlist_items i WHERE i.playlist_id = {t}.id AND i.tenant_id = {t}.tenant_id)' }, { label: 'Boards in it', decimals: 0 }),
      seconds: number({ sql: '(SELECT COALESCE(sum(i.duration_secs), 0) FROM screen_playlist_items i WHERE i.playlist_id = {t}.id AND i.tenant_id = {t}.tenant_id)' }, { label: 'Seconds round', decimals: 0, about: 'How long it takes to show every board once, times of day aside.' }),
      made_at: moment('created_at', { label: 'Made' }),
      changed_at: moment('updated_at', { label: 'Last changed' }),
    },
    measures: {
      playlists: count({ label: 'Playlists' }),
    },
    links: {
      screens: many('screens.screens', 'playlist_id', { label: 'Screens with it as their own' }),
      walls: many('screens.walls', 'playlist_id', { label: 'Walls showing it' }),
    },
    list: ['name', 'boards', 'seconds', 'changed_at'],
    sort: [{ by: 'name', dir: 'asc' }],
  }),

  subject({
    key: 'screens.walls',
    label: 'Screen walls',
    one: 'wall',
    area: 'tech',
    module: 'screens',
    about: 'The walls on the Screen walls page: screens side by side showing one board or playlist across them.',
    from: 'screen_walls',
    name: 'name',
    venue: 'venue_id',
    fields: {
      name: text('name'),
      columns: number('cols', { label: 'Across', decimals: 0 }),
      rows: number('rows', { label: 'Down', decimals: 0 }),
      places: number({ sql: '({t}.cols * {t}.rows)' }, { label: 'Places', decimals: 0, adds: true }),
      gap: number('gap', { label: 'Gap (px)', decimals: 0 }),
      shows_kind: choice({ sql: showsKind('{t}.playlist_id', '{t}.design_id') }, SHOWS, { label: 'Shows a', empty: 'Nothing' }),
      shows: text({ sql: showsName('{t}.playlist_id', '{t}.design_id') }, { label: 'Shows', empty: 'Nothing' }),
      made_at: moment('created_at', { label: 'Made' }),
    },
    measures: {
      walls: count({ label: 'Walls' }),
    },
    links: {
      board: one('screens.boards', 'design_id', { label: 'Board' }),
      playlist: one('screens.playlists', 'playlist_id', { label: 'Playlist' }),
      screens: many('screens.screens', 'wall_id', { label: 'Screens in it' }),
    },
    list: ['name', 'venue.name', 'columns', 'rows', 'shows'],
    sort: [{ by: 'name', dir: 'asc' }],
    skip: ['sort_order', 'updated_at'],
  }),
]
