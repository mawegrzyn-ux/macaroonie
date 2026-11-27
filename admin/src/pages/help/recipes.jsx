// src/pages/help/recipes.jsx
// The Help page's "Recipes" section (inventory phase 1). Help.jsx gathers
// every file in this folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox, DataTable } from './parts.jsx'

export const id = 'recipes'
export const label = 'Recipes'
export const order = 375

export function Section() {
  return (
    <section id="recipes" data-help="">
      <H2>Recipes</H2>
      <P>
        <strong>Recipes</strong> (main menu, under Stock) is your kitchen&apos;s recipe book: what goes into each
        dish and each batch you make, how to make it and a photo. Because every line is something you buy from
        a supplier, Macaroonie can also say what each recipe costs at each venue&apos;s own supplier prices, and
        show you exactly how that cost is worked out.
      </P>
      <H3>Dishes and prep recipes</H3>
      <P>
        A <strong>dish</strong> is what a guest is served: its cost is per portion (a recipe that makes two
        portions is divided by two). A <strong>prep</strong> recipe is something you make in batches, like a
        sauce, a marinade or a dough: say how much one batch makes (2 litres, 40 portions) and how much cooking
        loses (a stock that reduces by a quarter: 25%), and its cost is per litre, kilo or portion of what is
        left. A prep recipe can go inside other recipes, and prep recipes can sit inside each other up to five
        levels deep. A recipe can never end up inside itself: if a change would do that, the page says which
        recipes make the loop and Save stays off.
      </P>
      <H3>What goes into a recipe</H3>
      <P>
        Open a recipe and type in the search box under <strong>What goes into it</strong> to add an inventory
        item or a prep recipe. Give each line how much and in which unit: the standard units for what it is
        (g or kg, ml, cl or l, each), or one of the item&apos;s own units, such as a slice of cheese or a portion
        of chips (set on the Inventory page, see below). A line can have its own <strong>yield</strong> when this
        recipe trims harder than usual, and a note (diced, to garnish). Drag the grip on the left of a line to
        change the order. While you change the lines the cost on the right follows straight away, marked
        <strong> as changed</strong>; nothing is kept until you press <strong>Save</strong> on that card.
      </P>
      <P>
        The recipe&apos;s details (name, dish or prep, portions or what a batch makes, category, status) and its
        method and photo each have their own Save. A <strong>draft</strong> is still being worked on;
        <strong> live</strong> is the one the kitchen follows. Switch a recipe off to keep it out of the list
        without deleting it; a prep recipe used inside other recipes can&apos;t be deleted until it is taken out
        of them. Deleting asks twice.
      </P>
      <H3>Variations</H3>
      <P>
        <strong>Make a variation</strong> copies a recipe as a version of it: a takeaway version, a smaller
        kitchen&apos;s version, or one venue&apos;s own way of making it. A variation is listed under the recipe it
        varies and is a recipe of its own, so it has its own lines and its own cost. <strong>Copy</strong> makes
        a separate recipe instead. Which variation a dish uses at which venue and for which way of selling it
        (eat in, takeaway, delivery) is set when recipes are linked to your menus, which comes next.
      </P>
      <H3>What a recipe costs</H3>
      <P>
        People with <strong>Costing</strong> access see costs. Pick the venue the cost is worked out at (or your
        group&apos;s own prices) and how items are priced:
      </P>
      <DataTable
        head={['Priced by', 'What an item costs']}
        rows={[
          ['Standard', 'The price the venue orders it at today: the venue\'s chosen supplier price, else the group\'s, else the cheapest per kg, litre or each. This is the usual cost.'],
          ['Last paid', 'What the venue last paid for it: the invoice\'s price when there was one, else the price ordered at.'],
          ['Average paid', 'The average the venue paid over the last 90 days, by how much was received.'],
        ]}
      />
      <P>
        An item&apos;s <strong>yield</strong> is the share you can use after trimming. A recipe divides what it
        uses by the yield to say what has to be bought: 60 g of onion at 80% yield is 75 g bought. The recipe
        shows its cost per portion (or per unit for prep), the three ways of pricing side by side, and{' '}
        <strong>How it is worked out</strong>: every line with its quantity, the price it was costed at and
        where that price came from, then the total and the division by portions.
      </P>
      <H3>Fully, partly or not costed</H3>
      <P>
        A line that can&apos;t be costed is left out of the cost and listed in yellow with how to fix it, so a
        cost is never a confident wrong number. The usual reasons: an item with <strong>no supplier
        price</strong> (add one on the Inventory page), an item with <strong>no size for a unit</strong>{' '}
        (&ldquo;Cheddar has no size for a tbsp&rdquo;: give Cheddar a tbsp among its units, or use grams), a prep
        recipe with nothing in it or that doesn&apos;t say what it makes, or, on Last paid and Average paid,
        something never booked in at that venue. The list marks every recipe <strong>Fully costed</strong>,{' '}
        <strong>Partly costed</strong> or <strong>Not costed</strong>; tap a chip at the top to see only those.
      </P>
      <H3>Units and yield on inventory items</H3>
      <P>
        On the <strong>Inventory</strong> page, an item&apos;s drawer has a <strong>Units and yield</strong> card:
        its yield (what is left after trimming: an onion about 88%), the unit recipes usually use it in and the
        unit it is usually counted in, and its own units, each as so much of what it is counted in (1 slice = 20
        g, 1 each = 150 g for an item kept in grams, 1 tbsp = 15 ml). A unit a recipe uses can&apos;t be deleted
        (the page names the recipes); renaming it renames it in those recipes too. Changing units needs
        Purchasing setup.
      </P>
      <H3>Who can do what</H3>
      <DataTable
        head={['Access', 'View', 'Manage']}
        rows={[
          ['Recipes', 'Read recipes, their lines, methods and photos, and what can\'t be costed yet: no money.', 'Make and change recipes.'],
          ['Costing', 'See what recipes cost, line by line, and how it is worked out.', 'Cost targets and price scenarios (coming later).'],
        ]}
      />
      <P>
        Owners and admins have both; operators read recipes without costs; viewers have neither. Supplier names
        and pack prices in the explanation also need Purchasing setup.
      </P>
      <InfoBox type="tip">
        Ask Pepper &ldquo;what does the cheeseburger cost at Leeds?&rdquo;, &ldquo;which recipes aren&apos;t fully
        costed?&rdquo; or &ldquo;what goes into the cheese sauce?&rdquo;. Reports has <strong>Recipe cost by
        venue</strong> and <strong>Recipes not fully costed</strong> (under Recipes and costing).
      </InfoBox>
    </section>
  )
}
