-- 056_reviews.sql
-- Customer reviews: scraped (Apify), manual, or CSV-imported.
-- Adds google_place_id to venues so the scraper knows what to fetch.

BEGIN;

-- ── Reviews table ────────────────────────────────────────────

CREATE TABLE reviews (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id         uuid REFERENCES venues(id) ON DELETE SET NULL,
  platform         text NOT NULL DEFAULT 'google',
  external_id      text,
  reviewer_name    text,
  reviewer_photo_url text,
  rating           smallint CHECK (rating BETWEEN 1 AND 5),
  review_text      text,
  review_date      timestamptz,
  reply_text       text,
  is_approved      boolean NOT NULL DEFAULT false,
  is_featured      boolean NOT NULL DEFAULT false,
  source           text NOT NULL DEFAULT 'scraped',  -- scraped | manual | csv
  raw_data         jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY reviews_tenant ON reviews
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Deduplication: same platform + external_id within tenant should be unique
CREATE UNIQUE INDEX reviews_dedup_idx ON reviews (tenant_id, platform, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX reviews_venue_idx     ON reviews (venue_id);
CREATE INDEX reviews_platform_idx  ON reviews (platform);
CREATE INDEX reviews_approved_idx  ON reviews (tenant_id, is_approved);

-- ── Scrape jobs tracking ─────────────────────────────────────

CREATE TABLE review_scrape_jobs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id       uuid REFERENCES venues(id) ON DELETE SET NULL,
  platform       text NOT NULL DEFAULT 'google',
  apify_run_id   text,
  status         text NOT NULL DEFAULT 'pending',  -- pending | running | done | failed
  result_count   int,
  error_message  text,
  triggered_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz
);

ALTER TABLE review_scrape_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY scrape_jobs_tenant ON review_scrape_jobs
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── google_place_id on venues ─────────────────────────────────
-- The scraper needs the Google Maps Place ID (or URL) per venue.

ALTER TABLE venues ADD COLUMN IF NOT EXISTS google_place_id text;

COMMIT;
