-- 082_website_staging_production.sql
--
-- Staging -> production publishing model for the tenant website builder.
--
-- Until now every admin edit to tenant_site / website_config /
-- website_pages was immediately live everywhere. This adds a real
-- staging/production split:
--
--   - The existing editable tables ARE the staging/draft copy — no
--     change to how the admin edits anything.
--   - `published_snapshot` freezes the site's content (tenant_site
--     content fields + each venue's website_config + published pages)
--     at the moment of publish. Production (the plain subdomain and any
--     verified custom domain) renders from this snapshot.
--   - `staging-{subdomain_slug}.macaroonie.com` always renders the live
--     draft tables, ignoring is_published, so operators can preview
--     in-progress work regardless of whether anything has been
--     published yet.
--   - Menus, gallery/media, reviews, and schedule-sourced opening hours
--     are NOT part of the snapshot — they keep their own separate
--     publish/moderation state and stay live-shared between staging and
--     production, matching how they already work today.
--
-- `scheduled_publish_at` backs a delayed BullMQ job (see
-- api/src/jobs/publishWorker.js) that runs the same publish routine at
-- a future time instead of immediately.
--
-- The `staging-` prefix is reserved so a tenant can never claim a
-- subdomain_slug that would collide with another tenant's staging host.

ALTER TABLE tenant_site
  ADD COLUMN published_snapshot    jsonb,
  ADD COLUMN published_at          timestamptz,
  ADD COLUMN scheduled_publish_at  timestamptz;

ALTER TABLE tenant_site
  ADD CONSTRAINT tenant_site_slug_not_staging_prefix
  CHECK (subdomain_slug IS NULL OR subdomain_slug NOT LIKE 'staging-%');

-- Backfill: every tenant already live under the old "is_published is the
-- only gate" model gets an initial snapshot built from their CURRENT
-- content, so production keeps serving exactly what it was serving before
-- this deploy — nobody's live site goes dark just because "publish" now
-- means something more specific. Only tenants with is_published = true
-- AND no snapshot yet are touched; re-running this migration is a no-op
-- (the WHERE clause excludes rows that already got a snapshot).
WITH ts_content AS (
  SELECT
    id, tenant_id,
    jsonb_build_object(
      'brand_name', brand_name, 'logo_url', logo_url, 'favicon_url', favicon_url,
      'primary_colour', primary_colour, 'secondary_colour', secondary_colour,
      'font_family', font_family, 'template_key', template_key, 'theme', theme,
      'social_links', social_links, 'og_image_url', og_image_url,
      'ga4_measurement_id', ga4_measurement_id, 'fb_pixel_id', fb_pixel_id,
      'banner_enabled', banner_enabled, 'banner_text', banner_text,
      'banner_link_url', banner_link_url, 'banner_link_text', banner_link_text,
      'banner_severity', banner_severity, 'site_name', site_name, 'tagline', tagline,
      'meta_title', meta_title, 'meta_description', meta_description,
      'home_blocks', home_blocks, 'hide_locations_index', hide_locations_index,
      'locations_heading', locations_heading, 'locations_intro', locations_intro,
      'default_widget_venue_id', default_widget_venue_id,
      'cookies_banner_enabled', cookies_banner_enabled, 'cookies_banner_text', cookies_banner_text,
      'cookies_banner_accept_text', cookies_banner_accept_text, 'cookies_banner_decline_text', cookies_banner_decline_text,
      'widget_settings', widget_settings, 'bimi_svg', bimi_svg,
      'header_config', header_config, 'footer_config', footer_config,
      'home_show_header', home_show_header, 'home_show_footer', home_show_footer
    ) AS content
  FROM tenant_site
  WHERE is_published = true AND published_snapshot IS NULL
),
venue_cfg AS (
  -- jsonb_build_object caps out at 100 arguments (50 key/value pairs) —
  -- website_config has more content columns than that, so this is split
  -- into two calls concatenated with ||.
  SELECT
    v.tenant_id, wc.venue_id,
    jsonb_build_object(
      -- 'id' (this website_config row's own id) is NOT content — it's the
      -- stable FK that website_gallery_images / website_menu_documents /
      -- website_allergen_info / manual website_opening_hours join against.
      -- Those stay live-shared between staging and production (see
      -- migration header), so the frozen config still needs this id for
      -- those joins to keep working when rendering from a snapshot.
      'id', wc.id,
      'site_name', wc.site_name, 'tagline', wc.tagline, 'logo_url', wc.logo_url, 'favicon_url', wc.favicon_url,
      'primary_colour', wc.primary_colour, 'secondary_colour', wc.secondary_colour, 'font_family', wc.font_family,
      'hero_image_url', wc.hero_image_url, 'hero_heading', wc.hero_heading, 'hero_subheading', wc.hero_subheading,
      'hero_cta_text', wc.hero_cta_text, 'hero_cta_link', wc.hero_cta_link,
      'about_heading', wc.about_heading, 'about_text', wc.about_text, 'about_html', wc.about_html, 'about_image_url', wc.about_image_url,
      'address_line1', wc.address_line1, 'address_line2', wc.address_line2, 'city', wc.city, 'postcode', wc.postcode,
      'country', wc.country, 'latitude', wc.latitude, 'longitude', wc.longitude, 'google_maps_embed_url', wc.google_maps_embed_url,
      'phone', wc.phone, 'email', wc.email,
      'social_links', wc.social_links, 'online_ordering_links', wc.online_ordering_links, 'delivery_links', wc.delivery_links,
      'widget_venue_id', wc.widget_venue_id, 'widget_theme', wc.widget_theme,
      'og_image_url', wc.og_image_url, 'ga4_measurement_id', wc.ga4_measurement_id, 'fb_pixel_id', wc.fb_pixel_id
    ) || jsonb_build_object(
      'show_booking_widget', wc.show_booking_widget, 'show_menu', wc.show_menu, 'show_allergens', wc.show_allergens,
      'show_gallery', wc.show_gallery, 'show_find_us', wc.show_find_us, 'show_contact', wc.show_contact,
      'show_ordering', wc.show_ordering, 'show_delivery', wc.show_delivery,
      'template_key', wc.template_key, 'theme', wc.theme,
      'gallery_style', wc.gallery_style, 'gallery_size', wc.gallery_size,
      'opening_hours_source', wc.opening_hours_source, 'page_blocks', wc.page_blocks,
      'show_header', wc.show_header, 'show_footer', wc.show_footer,
      'cuisine', wc.cuisine, 'price_range', wc.price_range
    ) AS content
  FROM website_config wc
  JOIN venues v ON v.id = wc.venue_id
),
venue_cfg_agg AS (
  SELECT tenant_id, jsonb_object_agg(venue_id::text, content) AS configs
  FROM venue_cfg
  GROUP BY tenant_id
),
page_json AS (
  SELECT
    tenant_id, venue_id,
    jsonb_build_object(
      'id', id, 'slug', slug, 'title', title, 'content', content, 'blocks', blocks,
      'kind', kind, 'is_legal', is_legal, 'sort_order', sort_order,
      'show_header', show_header, 'show_footer', show_footer
    ) AS page,
    sort_order, title
  FROM website_pages
  WHERE is_published = true
),
tenant_pages_agg AS (
  SELECT tenant_id, jsonb_agg(page ORDER BY sort_order, title) AS pages
  FROM page_json
  WHERE venue_id IS NULL
  GROUP BY tenant_id
),
venue_pages_agg AS (
  SELECT tenant_id, jsonb_object_agg(venue_id::text, pages) AS pages
  FROM (
    SELECT tenant_id, venue_id, jsonb_agg(page ORDER BY sort_order, title) AS pages
    FROM page_json
    WHERE venue_id IS NOT NULL
    GROUP BY tenant_id, venue_id
  ) grouped
  GROUP BY tenant_id
)
UPDATE tenant_site ts
   SET published_snapshot = jsonb_build_object(
         'tenant_site',   tsc.content,
         'tenant_pages',  COALESCE(tpa.pages, '[]'::jsonb),
         'venue_configs', COALESCE(vca.configs, '{}'::jsonb),
         'venue_pages',   COALESCE(vpa.pages, '{}'::jsonb)
       ),
       published_at = now()
  FROM ts_content tsc
  LEFT JOIN venue_cfg_agg    vca ON vca.tenant_id = tsc.tenant_id
  LEFT JOIN tenant_pages_agg tpa ON tpa.tenant_id = tsc.tenant_id
  LEFT JOIN venue_pages_agg  vpa ON vpa.tenant_id = tsc.tenant_id
 WHERE ts.id = tsc.id;
