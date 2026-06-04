#!/usr/bin/env node
// One-shot script: seeds the three JJ/JP order sheet templates from the
// imported Excel file. Safe to re-run — skips any template whose name
// already exists for the tenant.
//
// Usage (from /home/ubuntu/app):
//   set -a; source api/.env; set +a
//   node api/scripts/seed-order-templates.js
//
// Pass --tenant=<id> to target a specific tenant UUID; otherwise seeds the
// first active tenant found.

import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL, { max: 1 })

const TEMPLATES = [
  {
    name: 'JJ Foods',
    show_prices: false,
    items: [
      { name: 'Chicken breast',         unit: '2x5 kg.' },
      { name: 'Chicken inner',          unit: '2x5kg.' },
      { name: 'Top side beef',          unit: '21kg.' },
      { name: 'Prawns 26/30',           unit: 'box (6)' },
      { name: 'Mussel',                 unit: 'box' },
      { name: 'Tilapia',                unit: 'box (5 kg.)' },
      { name: 'Pangus fish',            unit: '5kg.' },
      { name: 'Squid ring',             unit: '1 kg.' },
      { name: 'Ribs',                   unit: 'box (10 kg.)' },
      { name: 'Frozen wing',            unit: '10 kg.' },
      { name: 'Frozen corn',            unit: '2.5kg.' },
      { name: 'Loin pork',              unit: '6kg.' },
      { name: 'Plain flour',            unit: '16kg.' },
      { name: 'Egg',                    unit: 'box' },
      { name: 'Sugar',                  unit: 'pack (15kg)' },
      { name: 'Oil',                    unit: '20 Ltr' },
      { name: 'Ketchup',                unit: 'box (2 tub)' },
      { name: 'White vinegar',          unit: 'box (4 gal)' },
      { name: 'Salt',                   unit: '5kg.' },
      { name: 'Onion',                  unit: '4kg.' },
      { name: 'Peeled garlic',          unit: '5 kg.' },
      { name: 'Red pepper',             unit: '5 kg.' },
      { name: 'Spring onion',           unit: 'box' },
      { name: 'Carrot',                 unit: '10kg.' },
      { name: 'Coffee bean',            unit: 'box' },
      { name: 'Courgette',              unit: '10kg' },
      { name: 'Flat cabbage',           unit: '5 heads' },
      { name: 'Blue roll',              unit: 'pack (6)' },
      { name: 'Scour/sponge',           unit: 'pack (6)' },
      { name: 'Scourer',                unit: 'pack (12)' },
      { name: 'Metal scourer',          unit: 'pack (10)' },
      { name: 'Prep glove',             unit: 'box (50)' },
      { name: 'Yellow glove',           unit: 'pack (6)' },
      { name: 'Heavy duty bin liner',   unit: 'box (200)' },
      { name: 'Cling film 30mm',        unit: 'box' },
      { name: 'Cleaning cloth',         unit: 'pack' },
      { name: 'Container 500',          unit: 'box' },
      { name: 'Container 600',          unit: 'box' },
      { name: '2oz container with lid', unit: 'box' },
      { name: 'PC bag',                 unit: 'box' },
      { name: 'Washing up liquid',      unit: 'box (2)' },
      { name: 'Bleach',                 unit: 'box (2)' },
      { name: 'Degreaser',              unit: 'box (2)' },
      { name: 'Coke',                   unit: 'pack (24)' },
      { name: 'Diet Coke',              unit: 'pack (24)' },
      { name: '7 Up',                   unit: 'pack (24)' },
      { name: 'Still water',            unit: 'box (24)' },
      { name: 'Sparkling water',        unit: 'box (24)' },
      { name: 'Coke Zero',              unit: 'pack (24)' },
      { name: 'Orange juice',           unit: '12x Ltr' },
    ],
  },
  {
    name: 'JJ Oriental',
    show_prices: false,
    items: [
      { name: 'Lucky boat egg noodles No.1',  unit: 'box' },
      { name: '3mm rice noodles',             unit: 'box' },
      { name: '6" spring roll pastry',        unit: 'box' },
      { name: 'Panda oyster sauce',           unit: 'box' },
      { name: 'Baby corn small tin',          unit: 'box' },
      { name: 'Pineapple pieces small tin',   unit: 'box' },
      { name: 'Healthy boy soya sauce',       unit: 'box 5lt' },
      { name: 'Seasoning sauce golden mountain', unit: 'box' },
      { name: 'Squid fish sauce plastic',     unit: 'box' },
      { name: 'Golden panko breadcrumb',      unit: 'pack' },
      { name: 'Mae ploy panang',              unit: 'tub' },
      { name: 'Mae ploy massaman',            unit: 'tub' },
      { name: 'Mae ploy green',               unit: 'box' },
      { name: 'Mae ploy red',                 unit: 'box' },
      { name: 'Nittaya Kaeng Pa',             unit: 'pack' },
      { name: 'Mae ploy Tom yum',             unit: 'tub' },
      { name: 'Mae ploy chilli oil',          unit: 'tub' },
      { name: 'Crispy onion',                 unit: 'tub' },
      { name: 'Sriraja hot sauce',            unit: 'bottle' },
      { name: 'Hoisin sauce Amoy small tin',  unit: 'box' },
      { name: 'Choa koh small tin',           unit: 'box' },
      { name: 'Choa koh big tin',             unit: 'box' },
      { name: 'Bamboo shot sliced big tin',   unit: 'box' },
      { name: 'Yellow bean',                  unit: 'bottle' },
      { name: 'Dark soya sauce',              unit: 'bottle' },
      { name: 'Manarah PC',                   unit: 'box' },
      { name: 'Corn flour',                   unit: '3kg.' },
      { name: 'Chang tamarind seedless',      unit: 'pack' },
      { name: 'Chopped sweet radish',         unit: 'pack' },
      { name: 'Glass noodle',                 unit: '500g.' },
      { name: 'Coarse pepper',                unit: '500g.' },
      { name: 'White pepper powder',          unit: '500g.' },
      { name: 'Turmeric powder',              unit: '500g.' },
      { name: 'Curry powder',                 unit: '500g.' },
      { name: 'Cashew nut',                   unit: '10kg.' },
      { name: 'Sesame seed',                  unit: '1 kg.' },
      { name: 'Dried red big chilli',         unit: 'bag' },
      { name: 'Star anise / cinnamon wood',   unit: 'bag' },
      { name: 'Dried red small chilli',       unit: 'bag' },
      { name: 'Bamboo stick 6"',              unit: 'pack (10 bg)' },
      { name: 'Plastic bag S3',              unit: 'box' },
      { name: 'Plastic bag S4',              unit: 'box' },
      { name: 'Riceberry rice',               unit: 'box' },
      { name: 'Jasmin rice',                  unit: '20kg.' },
      { name: 'Long grain rice',              unit: '20kg.' },
      { name: 'Glutinous rice',               unit: '10 kg.' },
      { name: 'Dried chilli flakes',          unit: 'bag' },
      { name: 'Sesame seed oil',              unit: 'bottle' },
      { name: 'Glutinous rice flour BS',      unit: 'bag' },
      { name: 'Desiccated coconut BS',        unit: 'bag' },
    ],
  },
  {
    name: 'JP Fresh',
    show_prices: false,
    items: [
      { name: 'Small white cabbage',    unit: 'sack' },
      { name: 'Beansprouts',            unit: '4kg.' },
      { name: 'Bird eye chilli',        unit: 'box' },
      { name: 'Long red chilli',        unit: '3kg' },
      { name: 'Coriander',              unit: 'bunch' },
      { name: 'Ginger',                 unit: 'kg.' },
      { name: 'Krachai',                unit: 'kg.' },
      { name: 'Young peppercorn',       unit: '100g.' },
      { name: 'Lemongrass',             unit: '12x90g' },
      { name: 'Galangal',               unit: 'kg.' },
      { name: 'Fried tofu',             unit: 'kg.' },
      { name: 'FZ medal roasted duck',  unit: 'box (20)' },
      { name: 'Fz fishcake paste',      unit: 'box (20)' },
      { name: 'Fz lime leaf',           unit: '100g.' },
    ],
  },
]

async function main() {
  const targetArg = process.argv.find(a => a.startsWith('--tenant='))
  let tenantId

  if (targetArg) {
    tenantId = targetArg.split('=')[1]
    console.log(`Using specified tenant: ${tenantId}`)
  } else {
    const [tenant] = await sql`SELECT id, name FROM tenants WHERE is_active = true ORDER BY created_at LIMIT 1`
    if (!tenant) { console.error('No active tenant found'); process.exit(1) }
    tenantId = tenant.id
    console.log(`Using tenant: ${tenant.name} (${tenantId})`)
  }

  for (const tpl of TEMPLATES) {
    const [existing] = await sql`
      SELECT id FROM order_sheet_templates
       WHERE tenant_id = ${tenantId} AND name = ${tpl.name}
       LIMIT 1
    `
    if (existing) {
      console.log(`  SKIP  "${tpl.name}" — already exists`)
      continue
    }

    const [created] = await sql`
      INSERT INTO order_sheet_templates (tenant_id, name, show_prices, is_active, sort_order)
      VALUES (${tenantId}, ${tpl.name}, ${tpl.show_prices}, true,
        (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM order_sheet_templates WHERE tenant_id = ${tenantId}))
      RETURNING id
    `

    for (let i = 0; i < tpl.items.length; i++) {
      const item = tpl.items[i]
      await sql`
        INSERT INTO order_sheet_items (template_id, name, unit, sort_order)
        VALUES (${created.id}, ${item.name}, ${item.unit}, ${i + 1})
      `
    }

    console.log(`  CREATED "${tpl.name}" — ${tpl.items.length} items`)
  }

  await sql.end()
  console.log('Done.')
}

main().catch(e => { console.error(e); process.exit(1) })
