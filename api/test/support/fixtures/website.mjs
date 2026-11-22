// The website: the tenant's site and a venue's, pages (the built-in Loyalty
// page too), reviews, a media category.
export const order = 90

export async function fill(ctx) {
  const { V, mark, slug, step, post, put, patch, get } = ctx
  await step('tenant site', () => patch('/api/website/tenant-site', { subdomain_slug: slug + '-site', meta_title: mark + ' Thai House' }))
  await step('website config', () => post('/api/website/config', { venue_id: V }))
  const WV = '?venue_id=' + V
  await step('opening hours', () => post('/api/website/opening-hours' + WV, [1, 2, 3, 4, 5].map(d => ({ day_of_week: d, opens_at: '12:00', closes_at: '22:00', label: mark + ' hours' }))))
  await step('gallery image', () => post('/api/website/gallery' + WV, { image_url: '/uploads/test/' + slug + '.jpg', caption: mark + ' room' }))
  await step('allergen info', () => post('/api/website/allergens' + WV, { info_type: 'structured', structured_data: [{ dish: mark + ' Pad Thai', allergens: ['peanuts'] }] }))
  await step('staging password', () => put('/api/website/tenant-site/staging-access', { password: slug + '-secret-1' }))
  await step('website page', () => post('/api/website/pages', { venue_id: null, slug: slug + '-about', title: mark + ' About', kind: 'page', blocks: [] }))
  // The built-in Loyalty page (migration 214): its blocks change like any page's.
  const sitePages = await step('website pages', () => get('/api/website/pages?venue_id=tenant'))
  const loyaltyPage = (sitePages || []).find(p => p.system_key === 'loyalty')
  if (loyaltyPage) {
    await step('loyalty page', () => patch('/api/website/pages/' + loyaltyPage.id, {
      title: mark + ' Loyalty', blocks: [{ id: 'loy-card', type: 'loyalty_card', data: { heading: mark + ' Your card', show_history: false } }],
    }))
  }
  await step('review', () => post('/api/reviews', { venue_id: V, platform: 'google', reviewer_name: mark + ' Gus', rating: 4, review_text: mark + ' good' }))
  // Reviews recorded off a review site's page (migration 239).
  await step('reviews recorded', () => post('/api/reviews/record', {
    venue_id: V, platform: 'tripadvisor', page_url: 'https://tripadvisor.example/' + slug,
    reviews: [{ author: mark + ' Tess', rating: 5, text: mark + ' lovely pad thai', date: '2026-10-30', date_text: 'a week ago' }],
  }))
  await step('media category', () => post('/api/media/categories', { name: mark + ' Food' }))
}
