-- ============================================================
-- 025_website_cms.sql
--
-- Tenant Website Builder / CMS.
-- Each tenant can configure a branded public website served at
-- {subdomain_slug}.macaroonie.com.  The Fastify API renders the
-- site server-side from this config.
--
-- Tables:
--   website_config         — singleton per tenant (UNIQUE tenant_id)
--   website_opening_hours  — structured opening hours (7 × N sessions)
--   website_gallery_images — ordered gallery images
--   website_pages          — custom CMS pages (e.g. "Private Dining")
--   website_menu_documents — PDF menus
--   website_allergen_info  — allergen info (document or structured)
--
-- All tables are tenant-scoped via RLS using the existing
-- `app.tenant_id` session variable pattern.
-- ============================================================

-- ── website_config (singleton per tenant) ───────────────────
CREATE TABLE website_config (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,

  -- Identity / branding
  subdomain_slug    text        NOT NULL UNIQUE
                                CHECK (subdomain_slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
  site_name         text,
  tagline           text,
  logo_url          text,
  favicon_url       text,
  primary_colour    text        NOT NULL DEFAULT '#630812',
  secondary_colour  text,
  font_family       text        NOT NULL DEFAULT 'Inter',

  -- Hero section
  hero_image_url    text,
  hero_heading      text,
  hero_subheading   text,
  hero_cta_text     text        DEFAULT 'Book a Table',
  hero_cta_link     text        DEFAULT '#booking',

  -- About section
  about_heading     text,
  about_text        text,
  about_image_url   text,

  -- Find Us
  address_line1     text,
  address_line2     text,
  city              text,
  postcode          text,
  country           text        DEFAULT 'GB',
  latitude          numeric(10,7),
  longitude         numeric(10,7),
  google_maps_embed_url text,

  -- Contact
  phone             text,
  email             text,

  -- Flexible structured lists
  social_links          jsonb   NOT NULL DEFAULT '{}'::jsonb,  -- { instagram, facebook, ... }
  online_ordering_links jsonb   NOT NULL DEFAULT '[]'::jsonb,  -- [{ name, url, logo_key }]
  delivery_links        jsonb   NOT NULL DEFAULT '[]'::jsonb,  -- [{ provider, url }]

  -- Booking widget embed config
  widget_venue_id   uuid        REFERENCES venues(id) ON DELETE SET NULL,
  widget_theme      text        NOT NULL DEFAULT 'light'
                                CHECK (widget_theme IN ('light', 'dark')),

  -- SEO
  meta_title        text,
  meta_description  text,
  og_image_url      text,

  -- Analytics
  ga4_measurement_id text,
  fb_pixel_id        text,

  -- Feature toggles
  is_published          boolean NOT NULL DEFAULT false,
  show_booking_widget   boolean NOT NULL DEFAULT true,
  show_menu             boolean NOT NULL DEFAULT true,
  show_allergens        boolean NOT NULL DEFAULT true,
  show_gallery          boolean NOT NULL DEFAULT true,
  show_find_us          boolean NOT NULL DEFAULT true,
  show_contact          boolean NOT NULL DEFAULT true,
  show_ordering         boolean NOT NULL DEFAULT false,
  show_delivery         boolean NOT NULL DEFAULT false,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE website_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY website_config_tenant ON website_config
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE TRIGGER trg_website_config_updated_at
  BEFORE UPDATE ON website_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX website_config_slug_idx     ON website_config (subdomain_slug);
CREATE INDEX website_config_published_idx ON website_config (is_published) WHERE is_published;


-- ── website_opening_hours ───────────────────────────────────
CREATE TABLE website_opening_hours (
  id                 uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid    NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  website_config_id  uuid    NOT NULL REFERENCES website_config(id) ON DELETE CASCADE,
  day_of_week        int     NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  opens_at           time,
  closes_at          time,
  is_closed          boolean NOT NULL DEFAULT false,
  label              text,     -- e.g. "Lunch", "Dinner"
  sort_order         int     NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE website_opening_hours ENABLE ROW LEVEL SECURITY;

CREATE POLICY website_opening_hours_tenant ON website_opening_hours
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX website_opening_hours_cfg_idx
  ON website_opening_hours (website_config_id, day_of_week, sort_order);


-- ── website_gallery_images ──────────────────────────────────
CREATE TABLE website_gallery_images (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  website_config_id  uuid        NOT NULL REFERENCES website_config(id) ON DELETE CASCADE,
  image_url          text        NOT NULL,
  caption            text,
  sort_order         int         NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE website_gallery_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY website_gallery_tenant ON website_gallery_images
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX website_gallery_cfg_idx
  ON website_gallery_images (website_config_id, sort_order);


-- ── website_pages (custom CMS pages) ────────────────────────
CREATE TABLE website_pages (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  website_config_id  uuid        NOT NULL REFERENCES website_config(id) ON DELETE CASCADE,
  slug               text        NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  title              text        NOT NULL,
  content            text,                      -- HTML or Markdown
  is_published       boolean     NOT NULL DEFAULT true,
  sort_order         int         NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (website_config_id, slug)
);

ALTER TABLE website_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY website_pages_tenant ON website_pages
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE TRIGGER trg_website_pages_updated_at
  BEFORE UPDATE ON website_pages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX website_pages_cfg_idx
  ON website_pages (website_config_id, sort_order);


-- ── website_menu_documents ──────────────────────────────────
CREATE TABLE website_menu_documents (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  website_config_id  uuid        NOT NULL REFERENCES website_config(id) ON DELETE CASCADE,
  label              text        NOT NULL,   -- "Lunch Menu", "Drinks"
  file_url           text        NOT NULL,
  sort_order         int         NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE website_menu_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY website_menu_docs_tenant ON website_menu_documents
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX website_menu_docs_cfg_idx
  ON website_menu_documents (website_config_id, sort_order);


-- ── website_allergen_info (document or structured) ──────────
CREATE TABLE website_allergen_info (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  website_config_id  uuid        NOT NULL UNIQUE REFERENCES website_config(id) ON DELETE CASCADE,
  info_type          text        NOT NULL DEFAULT 'document'
                                 CHECK (info_type IN ('document', 'structured')),
  document_url       text,
  structured_data    jsonb       DEFAULT '[]'::jsonb,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE website_allergen_info ENABLE ROW LEVEL SECURITY;

CREATE POLICY website_allergen_tenant ON website_allergen_info
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE TRIGGER trg_website_allergen_updated_at
  BEFORE UPDATE ON website_allergen_info
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
