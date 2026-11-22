-- 264: loyalty card looks (22 Nov 2026, OUTSTANDING 44.4).
--
-- A programme can offer up to eight looks for the card (loyalty_programmes.
-- settings.themes, shared/loyalty.js normaliseProgramme()), and each member
-- picks their own in the loyalty app's Settings. Their pick is the look's id;
-- null is the standard look (the programme's card colours). A look the
-- programme stops offering leaves its members on the standard look
-- (memberCardColours()), so nothing here needs tidying when one goes.

ALTER TABLE loyalty_members ADD COLUMN IF NOT EXISTS card_theme text
  CHECK (card_theme IS NULL OR card_theme ~ '^[a-z0-9-]{1,32}$');
