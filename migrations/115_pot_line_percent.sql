-- 115_pot_line_percent.sql
--
-- Tip pot manual lines can now take money out as well as put it in, and can
-- be a percentage instead of a fixed amount.
--
--   tip_pot_lines.kind              'amount' (£, entered weekly, the only kind
--                                   until now) or 'percent' (% of the pot's
--                                   Cash Recon sources plus its £ lines).
--   rota_week_pot_lines.amount      the week's value: £ for an amount line,
--                                   % for a percent line. Either may be
--                                   negative (a deduction).

BEGIN;

ALTER TABLE tip_pot_lines
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'amount';
ALTER TABLE tip_pot_lines DROP CONSTRAINT IF EXISTS tip_pot_lines_kind_check;
ALTER TABLE tip_pot_lines
  ADD CONSTRAINT tip_pot_lines_kind_check CHECK (kind IN ('amount', 'percent'));

ALTER TABLE rota_week_pot_lines DROP CONSTRAINT IF EXISTS rota_week_pot_lines_amount_check;

COMMIT;
