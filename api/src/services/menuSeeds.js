// services/menuSeeds.js
//
// Sample menu data (One Thai Dinner + Lunch) the admin can import on
// demand via POST /api/menus/seed/:slug. Not run as a migration —
// operators choose when (and which tenant) to seed.

export const ONETHAI_DIETARY_TAGS = [
  { code: 'v',     label: 'Vegan-able',  glyph: 'V',  colour: '#6b8e4e', sort_order: 0 },
  { code: 'gf',    label: 'Gluten-free', glyph: 'GF', colour: '#7a1a26', sort_order: 1 },
  { code: 'n',     label: 'Nuts',        glyph: 'N',  colour: '#9a3412', sort_order: 2 },
  { code: 'spicy', label: 'Spicy',       glyph: '🌶', colour: '#c9302c', sort_order: 3 },
]

const D = {
  // Common variant sets — re-used across many curry/stir-fry dishes.
  CURRY_5_LOWER:   [{ label: 'Chicken', price_pence: 1350 }, { label: 'Pork', price_pence: 1350 }, { label: 'Prawns', price_pence: 1390 }, { label: 'Beef', price_pence: 1300 }, { label: 'Veg & Tofu', price_pence: 1350 }],
  CURRY_5_PANANG:  [{ label: 'Chicken', price_pence: 1300 }, { label: 'Pork', price_pence: 1300 }, { label: 'Prawns', price_pence: 1360 }, { label: 'Beef', price_pence: 1360 }, { label: 'Veg & Tofu', price_pence: 1300 }],
  CURRY_5_MASSAMAN:[{ label: 'Chicken', price_pence: 1390 }, { label: 'Pork', price_pence: 1390 }, { label: 'Prawns', price_pence: 1450 }, { label: 'Beef', price_pence: 1450 }, { label: 'Veg & Tofu', price_pence: 1390 }],
  STIRFRY_4:       [{ label: 'Chicken', price_pence: 1250 }, { label: 'Pork', price_pence: 1250 }, { label: 'Prawns', price_pence: 1340 }, { label: 'Beef', price_pence: 1300 }],
  STIRFRY_4_HIGHER:[{ label: 'Chicken', price_pence: 1290 }, { label: 'Pork', price_pence: 1290 }, { label: 'Prawns', price_pence: 1340 }, { label: 'Beef', price_pence: 1300 }],
  STIRFRY_5:       [{ label: 'Chicken', price_pence: 1250 }, { label: 'Pork', price_pence: 1250 }, { label: 'Prawns', price_pence: 1300 }, { label: 'Beef', price_pence: 1300 }, { label: 'Veg & Tofu', price_pence: 1250 }],
  PADTHAI_5:       [{ label: 'Chicken', price_pence: 1250 }, { label: 'Pork', price_pence: 1250 }, { label: 'Prawns', price_pence: 1290 }, { label: 'Beef', price_pence: 1290 }, { label: 'Veg & Tofu', price_pence: 1250 }],
  PADMEE_5:        [{ label: 'Chicken', price_pence: 1190 }, { label: 'Pork', price_pence: 1190 }, { label: 'Prawns', price_pence: 1290 }, { label: 'Beef', price_pence: 1290 }, { label: 'Veg & Tofu', price_pence: 1190 }],
  TOMSOUP:         [{ label: 'Chicken', price_pence: 700 }, { label: 'Mushrooms', price_pence: 620 }, { label: 'Prawns', price_pence: 770 }],
  // Lunch variants — slightly lower prices than dinner.
  LUNCH_CURRY:     [{ label: 'Chicken', price_pence: 980 }, { label: 'Pork', price_pence: 980 }, { label: 'Prawns', price_pence: 1050 }, { label: 'Beef', price_pence: 1050 }, { label: 'Veg', price_pence: 980 }],
  LUNCH_CURRY_PANANG:[{ label: 'Chicken', price_pence: 1060 }, { label: 'Pork', price_pence: 1060 }, { label: 'Prawns', price_pence: 1130 }, { label: 'Beef', price_pence: 1130 }, { label: 'Veg', price_pence: 1060 }],
  LUNCH_MASSAMAN:  [{ label: 'Chicken', price_pence: 1060 }, { label: 'Beef', price_pence: 1130 }, { label: 'Prawns', price_pence: 1130 }, { label: 'Veg', price_pence: 1060 }],
  LUNCH_STIRFRY:   [{ label: 'Chicken', price_pence: 980 }, { label: 'Pork', price_pence: 980 }, { label: 'Prawns', price_pence: 1050 }, { label: 'Beef', price_pence: 1050 }, { label: 'Veg', price_pence: 980 }],
  LUNCH_RICEBOWL:  [{ label: 'Chicken', price_pence: 980 }, { label: 'Pork', price_pence: 980 }, { label: 'Prawns', price_pence: 1050 }, { label: 'Beef', price_pence: 1050 }, { label: 'Veg', price_pence: 980 }],
  LUNCH_NOODLES:   [{ label: 'Chicken', price_pence: 980 }, { label: 'Pork', price_pence: 980 }, { label: 'Prawns', price_pence: 1050 }, { label: 'Beef', price_pence: 1050 }, { label: 'Veg', price_pence: 980 }],
  LUNCH_PADKEEMAO: [{ label: 'Chicken', price_pence: 980 }, { label: 'Pork', price_pence: 980 }, { label: 'Prawns', price_pence: 1050 }, { label: 'Beef', price_pence: 1050 }, { label: 'Duck', price_pence: 1060 }],
  LUNCH_PADMEE:    [{ label: 'Chicken', price_pence: 980 }, { label: 'Pork', price_pence: 980 }, { label: 'Prawns', price_pence: 1050 }, { label: 'Beef', price_pence: 1050 }, { label: 'Duck', price_pence: 1060 }],
  LUNCH_PADSEEEW:  [{ label: 'Chicken', price_pence: 980 }, { label: 'Pork', price_pence: 980 }, { label: 'Prawns', price_pence: 1050 }, { label: 'Beef', price_pence: 1050 }, { label: 'Duck', price_pence: 1060 }],
}

// ── Dinner ─────────────────────────────────────────────────

export const ONETHAI_DINNER = {
  name: 'Dinner Menu',
  slug: 'dinner',
  tagline: 'classics, curries & everything in between',
  service_times: 'Tue–Sat · Dinner 6 PM – 10 PM',
  print_columns: 6,
  sections: [
    { title: 'Starters', subtitle: 'to begin', items: [
      { name: 'Mixed Platter to Share', price_pence: 890, notes: 'pp · Min 2', description: 'All the favourites — spring rolls, prawn on toast, corn cake, song sa-hai, chicken satay.' },
      { name: 'Chicken Satay', price_pence: 750, dietary: ['gf'], description: 'Marinated chicken on skewers with peanut sauce.' },
      { name: 'Por Pia (Spring Rolls)', price_pence: 650, dietary: ['v'], description: 'Golden rice pastry, vermicelli, crunchy veg, sweet chilli sauce.' },
      { name: 'Song Sa-Hai Rolls', price_pence: 720, description: 'Prawn & chicken with Thai herbs, wrapped & fried golden.' },
      { name: 'Goong Tempura', price_pence: 770, description: 'King prawns in tempura batter, sweet chilli sauce.' },
      { name: 'Prawn on Toast', price_pence: 770, description: 'Minced prawn with garlic, pepper, coriander on toast.' },
      { name: 'Tod Man Pla', price_pence: 770, dietary: ['gf', 'n'], description: 'Fish cakes with red curry paste, lime leaves, fine beans.' },
      { name: 'Eagle Wings', price_pence: 690, description: 'Chicken wings, garlic, pepper & coriander sauce.' },
      { name: 'Spare Ribs', price_pence: 780, description: 'Pork ribs marinated with honey, cinnamon, anise & herbs.' },
      { name: 'Sweetcorn Cakes', price_pence: 690, dietary: ['v'], description: 'Sweetcorn, Thai herbs, hint of curry paste, sweet chilli sauce.' },
      { name: 'Crispy Tofu', price_pence: 650, dietary: ['gf', 'n', 'v'], description: 'Crispy outside, soft inside, sweet chilli & peanuts.' },
      { name: 'Thai Prawn Crackers', price_pence: 390, dietary: ['gf'], description: 'Slightly spicy, with sweet chilli sauce.' },
    ]},
    { title: 'Soups', subtitle: 'bright & fragrant', items: [
      { name: 'Tom Yum',              dietary: ['gf', 'spicy'], description: 'Hot & sour with galangal, lemongrass, lime leaves, mushrooms, tomatoes.', variants: D.TOMSOUP },
      { name: 'Tom Kha',              dietary: ['gf', 'spicy'], description: 'Tom Yum with coconut milk & herbs — silkier, gentler.',                 variants: D.TOMSOUP },
      { name: "Poh Taek (Fisherman's)", price_pence: 1050, dietary: ['gf'], description: 'Mussels, squid, prawns in spicy & sour broth. Lemongrass, galangal, lime leaves.' },
    ]},
    { title: 'Curries', subtitle: 'add rice or noodles', items: [
      { name: 'Green Curry',  native_name: 'แกงเขียวหวาน', dietary: ['gf', 'spicy'], description: 'Sharp, sweet, medium-spicy, coconut milk, courgettes, bamboo, peppers.', variants: D.CURRY_5_LOWER },
      { name: 'Red Curry',    native_name: 'แกงเผ็ด',     dietary: ['gf', 'spicy'], description: 'Bolder & smoother, medium-spicy, coconut milk, courgettes, bamboo, peppers.', variants: D.CURRY_5_LOWER },
      { name: 'Panang Curry', native_name: 'พะแนง',        dietary: ['gf', 'spicy'], description: 'Creamy, distinctive lime leaves, red peppers, finished with fresh lime leaves.', variants: D.CURRY_5_PANANG },
      { name: 'Massaman',     native_name: 'มัสมั่น',      dietary: ['gf', 'n'],     description: 'Mild, creamy, nutty, slow-cooked with star anise, potatoes, cashews. Best with beef.', variants: D.CURRY_5_MASSAMAN },
      { name: 'Kaeng Pa — Jungle', dietary: ['gf', 'spicy'], description: 'No coconut milk — wild ginger, lime leaves, lemongrass, mixed veg. For spice lovers.', variants: D.CURRY_5_MASSAMAN },
      { name: 'Duck Curry', price_pence: 1550, dietary: ['gf'], description: 'Roasted duck, coconut milk, red curry paste, cherry tomatoes, pineapple, basil.' },
      { name: 'Chu Chi Pla', price_pence: 1550, dietary: ['gf'], description: 'Fried white fish with thick Panang curry dressing & lime leaves.' },
    ]},
    { title: 'Stir-Fries', subtitle: 'add rice or noodles', items: [
      { name: 'Tod Kratiem',    dietary: ['gf'],            description: 'Garlic & coriander, home-made coriander sauce, on lettuce, peppered.',       variants: D.STIRFRY_4 },
      { name: 'Pad Med Ma Muang',                            description: 'Cashews, dried chilli, carrots, spring onions, light soya.',                variants: D.STIRFRY_4_HIGHER },
      { name: 'Pad Nam Mun Hoi',                             description: 'Oyster sauce, onions, carrots, mushrooms, spring onions. Optional ginger.', variants: D.STIRFRY_4 },
      { name: 'Pad Priew Whan', dietary: ['gf'],            description: 'Sweet & sour — pineapple, tomato, cucumber, carrots, spring onions.',        variants: D.STIRFRY_5 },
      { name: 'Pad Krapow',     dietary: ['v', 'spicy'],    description: "Chilli & basil, fine beans, peppers, onions, our 'Top Secret' sauce. Cannot be made mild.", variants: D.STIRFRY_5 },
      { name: 'Pad Kraprow Talay', price_pence: 1750,        description: "Mussels, prawns, squid with 'Top Secret' garlic-herb mix, peppers, basil." },
      { name: 'Pad Bok',         price_pence: 1250,          description: 'Stir-fried broccoli, cabbage, carrots, beansprouts, baby corn. Tofu optional.' },
    ]},
    { title: 'Thai Specials', subtitle: 'house favourites', highlight: true, items: [
      { name: 'Pla Rard Prix', price_pence: 1550, dietary: ['spicy'], is_featured: true, description: 'Fried fillet fish with herbs, garlic, peppers, onions, chilli sauce, on lettuce.' },
      { name: 'Ma Kham',                          dietary: ['spicy'], is_featured: true, description: 'Sweet-tangy tamarind sauce over duck or fish, crispy shallots, coriander.', variants: [{ label: 'Duck', price_pence: 1650 }, { label: 'White Fish', price_pence: 1550 }] },
      { name: 'Pad Cha',                          dietary: ['spicy'], is_featured: true, description: 'Wild ginger, lemongrass, basil, baby peppercorns, red & finger chillies.', variants: [{ label: 'Seafood', price_pence: 1750 }, { label: 'Duck', price_pence: 1650 }, { label: 'White Fish', price_pence: 1550 }] },
      { name: 'Ped Pad Prix', price_pence: 1650, dietary: ['spicy'], is_featured: true, description: 'Spicy, sweet, tangy duck — tamarind, garlic, peppers, chillies, on lettuce.' },
    ]},
    { title: 'Noodles', subtitle: 'share or solo', items: [
      { name: 'Pad Thai', native_name: 'ผัดไทย', dietary: ['gf', 'n'], description: 'Rice noodles, tamarind, sweet raddish, beansprouts, spring onions, peanuts on side.', variants: D.PADTHAI_5 },
      { name: 'Pad Mee',                                                description: 'Egg noodles, soya, beansprouts, cabbage, carrots, spring onions. Spicy on request.', variants: D.PADMEE_5 },
      { name: 'Just Egg Noodles', price_pence: 550, description: 'Egg noodles, beansprouts, carrots, spring onions. Side to Stir-fries.' },
    ]},
    { title: 'Rice', items: [
      { name: 'Thai Fragrant Rice', price_pence: 350, dietary: ['v'] },
      { name: 'Egg Fried Rice', price_pence: 420, dietary: ['v'], description: 'Wok-tossed with egg.' },
      { name: 'Sticky Rice', price_pence: 450, dietary: ['v'], description: 'Glutinous, eaten with fingers. Best with seabass & prawns.' },
      { name: 'Riceberry Rice', price_pence: 450, dietary: ['gf', 'v'], description: 'Deep purple, slightly sweet, rich in anthocyanin. Great with massaman.' },
    ]},
    { title: 'Sides', items: [
      { name: 'Side Pad Pak',        price_pence: 750, dietary: ['v'], description: 'Stir-fried mixed veg.' },
      { name: 'Stir-fried Broccoli', price_pence: 750, dietary: ['v'], description: 'Broccoli, garlic, light soya.' },
      { name: 'Beansprouts & Tofu',  price_pence: 750, dietary: ['v'], description: 'Fried tofu, blanched beansprouts, spring onions.' },
      { name: 'Stir-fried Courgettes', price_pence: 750, dietary: ['v'], description: 'Garlic, chilli, basil.' },
    ]},
    { title: 'Drinks · Tea', items: [
      { name: 'English Breakfast / Earl Grey', price_pence: 250 },
      { name: 'Sencha & Matcha',               price_pence: 300 },
      { name: 'Jasmine Pearls',                price_pence: 300 },
      { name: 'Organic Green Tea',             price_pence: 300 },
      { name: 'Ginger & Lemongrass',           price_pence: 300 },
      { name: 'Chamomile / Organic Mint',      price_pence: 300 },
    ]},
    { title: 'Drinks · Coffee', items: [
      { name: 'Espresso',                          price_pence: 250 },
      { name: 'Double Espresso',                   price_pence: 300 },
      { name: 'Americano / White',                 price_pence: 290 },
      { name: 'Cappuccino / Latte / Flat White',   price_pence: 290 },
      { name: 'Hot Chocolate',                     price_pence: 300 },
    ]},
    { title: 'Drinks · Soft & Other', items: [
      { name: 'Fizzy Drinks 330ml',         price_pence: 250 },
      { name: 'Water (still / sparkling)',  price_pence: 250 },
      { name: 'Orange Juice',               price_pence: 250 },
      { name: 'Corkage (per person)',       price_pence: 500 },
    ]},
  ],
  callouts: [
    { kind: 'allergens', title: 'Allergies & Diet', body: 'Please tell our staff. Most dishes can be made vegan or nut-free. All dishes are dairy free.' },
    { kind: 'go_large',  title: 'Go Large',         body: 'Most dishes can be made larger for £2.50.' },
    { kind: 'thai_hot',  title: 'Make It Thai Hot', body: 'Tell us — chefs can adjust most dishes to taste.' },
    { kind: 'order_book', title: 'Order & Book',    body: 'Takeaway via onethai.com\nDeliveroo & Just Eat\nTel: 01920 485 978' },
  ],
}

// ── Lunch ──────────────────────────────────────────────────

export const ONETHAI_LUNCH = {
  name: 'Lunch Menu',
  slug: 'lunch',
  tagline: 'quick, fresh & honest',
  service_times: 'Tue–Sat · 11:30 AM – 2 PM',
  intro_line: 'Looking for starters? Our dinner menu is available all day — just ask. All curry & rice and stir-fry dishes are served with jasmine rice on the side.',
  print_columns: 4,
  sections: [
    { title: 'Curry & Rice', subtitle: 'with jasmine rice', items: [
      { name: 'Green Curry',  dietary: ['gf', 'spicy'], description: 'Sharp, sweet, medium-spicy. Coconut milk, courgettes, bamboo, peppers.',                variants: D.LUNCH_CURRY },
      { name: 'Red Curry',    dietary: ['gf', 'spicy'], description: 'Bolder & smoother, medium-spicy. Coconut milk, courgettes, bamboo, peppers.',           variants: D.LUNCH_CURRY },
      { name: 'Panang Curry', dietary: ['gf', 'spicy'], description: 'Creamy, distinctive lime leaves. Coconut milk, red peppers, fresh lime leaves.',        variants: D.LUNCH_CURRY_PANANG },
      { name: 'Massaman Curry', dietary: ['gf', 'n'],   description: 'Mild, creamy, nutty. Star anise, herbs, potatoes, cashews. Best with beef.',            variants: D.LUNCH_MASSAMAN },
      { name: 'Duck Curry',   price_pence: 1060, dietary: ['gf'], description: 'Roasted duck, coconut milk, red curry paste, cherry tomatoes, pineapple, basil.' },
    ]},
    { title: 'Stir-Fry & Rice', subtitle: 'with jasmine rice', items: [
      { name: 'Pad Med Ma Muang', dietary: ['v'],         description: 'Cashews, dried chilli, carrots, spring onions, light soya.',           variants: D.LUNCH_STIRFRY },
      { name: 'Pad Nam Mun Hoi',  dietary: ['v'],         description: 'Oyster sauce, onions, carrots, mushrooms, spring onions. Optional ginger.', variants: D.LUNCH_STIRFRY },
      { name: 'Pad Krapow',       dietary: ['v', 'spicy'], description: "Chilli & basil, fine beans, peppers, onions, our 'Top Secret' sauce. Cannot be made mild.", variants: D.LUNCH_STIRFRY },
      { name: 'Pad Pak',          price_pence: 980, dietary: ['v'], description: 'Stir-fried broccoli, cabbage, carrots, beansprouts, baby corn. Tofu optional.' },
    ]},
    { title: 'Stir-Fried Rice', subtitle: 'a meal in a bowl', items: [
      { name: 'Kau Pad Supparod',      dietary: ['n'],         description: 'Pineapple fried rice, egg, onions, carrots, cabbage, tomatoes, cashews, turmeric.', variants: D.LUNCH_RICEBOWL },
      { name: 'Kau Pad',                                        description: 'Simple fried rice, egg, onions, carrots, cabbage, tomatoes, spring onions.',         variants: D.LUNCH_RICEBOWL },
      { name: 'Kau Pad Nam Prik Pao', dietary: ['spicy'],     description: "'A bit' spicy fried rice, Thai herbs, chilli oil, onions, carrots, cabbage. Optional egg.", variants: D.LUNCH_RICEBOWL },
    ]},
    { title: 'Stir-Fried Noodles', subtitle: 'comforting & quick', items: [
      { name: 'Pad Thai',  dietary: ['gf', 'n'],   description: 'Rice noodles, tamarind, sweet raddish, beansprouts, carrots, spring onions, peanuts on side.', variants: D.LUNCH_NOODLES },
      { name: 'Pad Mee',                            description: 'Quick & mild egg noodles, soya, beansprouts, cabbage, carrots, spring onions.',                  variants: D.LUNCH_PADMEE },
      { name: 'Pad Kee Mao', dietary: ['spicy'],   description: 'Spicy rice noodles, fine beans, bamboo, chilli, garlic, peppers, basil.',                          variants: D.LUNCH_PADKEEMAO },
      { name: 'Pad See Eew',                        description: 'Stir-fried rice noodles, dark soya, cabbage, carrots, spring onions.',                            variants: D.LUNCH_PADSEEEW },
    ]},
  ],
  callouts: [
    { kind: 'allergens', title: 'Allergies & Diet', body: 'Please tell our staff. Most dishes can be made vegan or nut-free. All dishes are dairy free.' },
    { kind: 'go_large',  title: 'Go Large',         body: 'Most dishes can be made larger for £2.00.' },
    { kind: 'thai_hot',  title: 'Make It Thai Hot', body: 'Tell us — chefs can adjust most dishes to taste.' },
    { kind: 'order_book', title: 'Order & Book',    body: 'Takeaway via onethai.com\nDeliveroo & Just Eat\nTel: 01920 485 978' },
  ],
}

export const SEED_BY_SLUG = {
  'onethai-dinner': ONETHAI_DINNER,
  'onethai-lunch':  ONETHAI_LUNCH,
}
