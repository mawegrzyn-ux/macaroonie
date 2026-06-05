-- 063_seed_order_sheet_items.sql
-- Clears and re-seeds order sheet templates with logical items and category assignments.
-- Pre-prod: safe to truncate.

DELETE FROM order_sheet_items;
DELETE FROM order_sheet_templates;

-- Re-seed the 4 default templates
INSERT INTO order_sheet_templates (tenant_id, name, show_prices, delivery_days, is_active)
SELECT id, 'Daily Produce',        false, ARRAY[1,2,3,4,5], true FROM tenants
UNION ALL
SELECT id, 'Meat & Fish',          false, ARRAY[1,4],        true FROM tenants
UNION ALL
SELECT id, 'Weekly Dry Goods',     false, ARRAY[1],          true FROM tenants
UNION ALL
SELECT id, 'Cleaning & Packaging', false, ARRAY[1],          true FROM tenants;

-- Seed items per template, resolving category_id from shared category names
INSERT INTO order_sheet_items (template_id, name, unit, category_id, sort_order)
SELECT
  t.id,
  s.item_name,
  s.unit,
  c.id,
  s.so
FROM order_sheet_templates t
JOIN order_sheet_categories c ON c.tenant_id = t.tenant_id AND c.name = s.cat
CROSS JOIN (VALUES

  -- Daily Produce ----------------------------------------------------------
  ('Daily Produce', 'Tomatoes',           'kg',        'Vegetables',                 0),
  ('Daily Produce', 'Onions',             'kg',        'Vegetables',                 1),
  ('Daily Produce', 'Garlic',             'kg',        'Vegetables',                 2),
  ('Daily Produce', 'Bell Peppers',       'kg',        'Vegetables',                 3),
  ('Daily Produce', 'Mushrooms',          'kg',        'Vegetables',                 4),
  ('Daily Produce', 'Courgettes',         'kg',        'Vegetables',                 5),
  ('Daily Produce', 'Leeks',              'kg',        'Vegetables',                 6),
  ('Daily Produce', 'Spinach',            'bag',       'Vegetables',                 7),
  ('Daily Produce', 'Carrots',            'kg',        'Vegetables',                 8),
  ('Daily Produce', 'Celery',             'bunch',     'Vegetables',                 9),
  ('Daily Produce', 'Cucumber',           'each',      'Vegetables',                10),
  ('Daily Produce', 'Lemons',             'kg',        'Fruit',                     11),
  ('Daily Produce', 'Limes',              'kg',        'Fruit',                     12),
  ('Daily Produce', 'Oranges',            'kg',        'Fruit',                     13),
  ('Daily Produce', 'Fresh Basil',        'bunch',     'Herbs & Garnish',           14),
  ('Daily Produce', 'Fresh Parsley',      'bunch',     'Herbs & Garnish',           15),
  ('Daily Produce', 'Fresh Thyme',        'bunch',     'Herbs & Garnish',           16),
  ('Daily Produce', 'Fresh Rosemary',     'bunch',     'Herbs & Garnish',           17),
  ('Daily Produce', 'Chives',             'bunch',     'Herbs & Garnish',           18),
  ('Daily Produce', 'Micro Herbs',        'box',       'Herbs & Garnish',           19),

  -- Meat & Fish ------------------------------------------------------------
  ('Meat & Fish',   'Chicken Breast',     'kg',        'Meat & Poultry',             0),
  ('Meat & Fish',   'Chicken Thighs',     'kg',        'Meat & Poultry',             1),
  ('Meat & Fish',   'Beef Mince',         'kg',        'Meat & Poultry',             2),
  ('Meat & Fish',   'Sirloin Steak',      'kg',        'Meat & Poultry',             3),
  ('Meat & Fish',   'Pork Belly',         'kg',        'Meat & Poultry',             4),
  ('Meat & Fish',   'Lamb Rack',          'kg',        'Meat & Poultry',             5),
  ('Meat & Fish',   'Duck Breast',        'kg',        'Meat & Poultry',             6),
  ('Meat & Fish',   'Salmon Fillet',      'kg',        'Fish & Seafood',             7),
  ('Meat & Fish',   'Sea Bass Fillet',    'kg',        'Fish & Seafood',             8),
  ('Meat & Fish',   'Cod Fillet',         'kg',        'Fish & Seafood',             9),
  ('Meat & Fish',   'Tiger Prawns',       'kg',        'Fish & Seafood',            10),
  ('Meat & Fish',   'Scallops',           'kg',        'Fish & Seafood',            11),
  ('Meat & Fish',   'Squid',              'kg',        'Fish & Seafood',            12),

  -- Weekly Dry Goods -------------------------------------------------------
  ('Weekly Dry Goods', 'Penne Pasta',           '3kg bag',   'Dry Goods',                 0),
  ('Weekly Dry Goods', 'Spaghetti',             '3kg bag',   'Dry Goods',                 1),
  ('Weekly Dry Goods', 'Arborio Rice',          '3kg bag',   'Dry Goods',                 2),
  ('Weekly Dry Goods', 'Basmati Rice',          '3kg bag',   'Dry Goods',                 3),
  ('Weekly Dry Goods', 'Plain Flour',           '16kg sack', 'Dry Goods',                 4),
  ('Weekly Dry Goods', 'Breadcrumbs',           'kg',        'Dry Goods',                 5),
  ('Weekly Dry Goods', 'Caster Sugar',          'kg',        'Dry Goods',                 6),
  ('Weekly Dry Goods', 'Cornflour',             'kg',        'Dry Goods',                 7),
  ('Weekly Dry Goods', 'Olive Oil',             '5L',        'Oils, Sauces & Condiments', 8),
  ('Weekly Dry Goods', 'Vegetable Oil',         '5L',        'Oils, Sauces & Condiments', 9),
  ('Weekly Dry Goods', 'Soy Sauce',             '1L',        'Oils, Sauces & Condiments',10),
  ('Weekly Dry Goods', 'Worcestershire Sauce',  '500ml',     'Oils, Sauces & Condiments',11),
  ('Weekly Dry Goods', 'Tomato Paste',          '2.5kg tin', 'Oils, Sauces & Condiments',12),
  ('Weekly Dry Goods', 'Dijon Mustard',         '1kg',       'Oils, Sauces & Condiments',13),
  ('Weekly Dry Goods', 'White Wine Vinegar',    '1L',        'Oils, Sauces & Condiments',14),
  ('Weekly Dry Goods', 'Eggs',                  '30 box',    'Dairy & Eggs',             15),
  ('Weekly Dry Goods', 'Unsalted Butter',       'kg',        'Dairy & Eggs',             16),
  ('Weekly Dry Goods', 'Double Cream',          'L',         'Dairy & Eggs',             17),
  ('Weekly Dry Goods', 'Parmesan',              'kg',        'Dairy & Eggs',             18),
  ('Weekly Dry Goods', 'Cheddar',               'kg',        'Dairy & Eggs',             19),
  ('Weekly Dry Goods', 'Sourdough Loaves',      'each',      'Bakery',                   20),
  ('Weekly Dry Goods', 'Burger Buns',           'doz',       'Bakery',                   21),
  ('Weekly Dry Goods', 'Dinner Rolls',          'doz',       'Bakery',                   22),

  -- Cleaning & Packaging ---------------------------------------------------
  ('Cleaning & Packaging', 'Degreaser',           '5L',    'Cleaning Supplies',  0),
  ('Cleaning & Packaging', 'Sanitizer',           '5L',    'Cleaning Supplies',  1),
  ('Cleaning & Packaging', 'Dish Soap',           '5L',    'Cleaning Supplies',  2),
  ('Cleaning & Packaging', 'Floor Cleaner',       '5L',    'Cleaning Supplies',  3),
  ('Cleaning & Packaging', 'Oven Cleaner',        '750ml', 'Cleaning Supplies',  4),
  ('Cleaning & Packaging', 'Bin Bags 75L',        'roll',  'Cleaning Supplies',  5),
  ('Cleaning & Packaging', 'Bin Bags 120L',       'roll',  'Cleaning Supplies',  6),
  ('Cleaning & Packaging', 'Blue Roll',           'case',  'Cleaning Supplies',  7),
  ('Cleaning & Packaging', 'Latex Gloves (M)',    'box',   'Cleaning Supplies',  8),
  ('Cleaning & Packaging', 'Takeaway Containers', 'case',  'Packaging',          9),
  ('Cleaning & Packaging', 'Takeaway Bags',       'case',  'Packaging',         10),
  ('Cleaning & Packaging', 'Napkins',             'case',  'Packaging',         11),
  ('Cleaning & Packaging', 'Cling Film',          'roll',  'Packaging',         12),
  ('Cleaning & Packaging', 'Aluminium Foil',      'roll',  'Packaging',         13),
  ('Cleaning & Packaging', 'Greaseproof Paper',   'roll',  'Packaging',         14),
  ('Cleaning & Packaging', 'Coffee Cups (8oz)',   'case',  'Packaging',         15),
  ('Cleaning & Packaging', 'Coffee Cup Lids',     'case',  'Packaging',         16)

) AS s(tpl, item_name, unit, cat, so)
WHERE t.name = s.tpl;
