// Menu screens: a board, a playlist of it, a wall.
export const order = 180

export const kinds = { designId: ['screen_designs'] }

export async function fill(ctx) {
  const { V, mark, step, post, put } = ctx
  const design = await step('screen design', () => post('/api/screens/designs', { name: mark + ' Board' }))
  const playlist = await step('screen playlist', () => post('/api/screens/playlists', { name: mark + ' Day' }))
  if (playlist && design) await step('playlist boards', () => put(`/api/screens/playlists/${playlist.id}`, { name: mark + ' Day', items: [{ design_id: design.id, duration_secs: 10 }] }))
  await step('screen wall', () => post('/api/screens/walls', { venue_id: V, name: mark + ' Wall', cols: 2, rows: 1 }))
}
