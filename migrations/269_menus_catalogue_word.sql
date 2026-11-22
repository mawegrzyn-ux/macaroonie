-- Menus as catalogues, step 5 (docs/CATALOGUE.md 4.4): what the group calls
-- its menus. null = worked out from the menus' types (groupWord() in
-- shared/catalogue.js: Menus when every one is food, Catalogues when none is,
-- Menus & catalogues when mixed); a value fixes it.
ALTER TABLE tenants
  ADD COLUMN catalogue_word text
    CHECK (catalogue_word IN ('menus', 'catalogues', 'menus_and_catalogues'));
