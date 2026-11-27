// src/pages/help/recipes.jsx
// The Help page's "Recipes" section (inventory phases 1 and 2: recipes, links
// to menu dishes by venue, revenue stream and order type, option rules, Menu
// margins and cost targets). Help.jsx gathers
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
        (eat in, takeaway, delivery) is set on the dish&apos;s matrix (below).
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
        something never booked in at that venue (on Average paid, nothing booked in there in the last 90 days).
        Deliveries booked in before an item&apos;s <strong>Counted in</strong> changed (from each to grams, say)
        don&apos;t count: their pack sizes are in the old unit. The list marks every recipe <strong>Fully costed</strong>,{' '}
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
          ['Recipes', 'Read recipes, their lines, methods and photos, which recipe each dish uses where, and what options do: no money.', 'Make and change recipes, link dishes and set option rules.'],
          ['Costing', 'See what recipes and dishes cost, how it is worked out, and Menu margins.', 'Set the cost targets on Menu margins (price scenarios come later).'],
        ]}
      />
      <P>
        Owners and admins have both; operators read recipes without costs; viewers have neither. Supplier names
        and pack prices in the explanation also need Purchasing setup.
      </P>
      <H3>Linking dishes to their recipes</H3>
      <P>
        The <strong>Dishes</strong> tab at the top of Recipes lists every dish on your menus with the recipe it
        uses, how many venues or ways of selling use another one, and whether that recipe can be costed. Filter
        by menu, or tap <strong>No recipe</strong> to see only the dishes still to link. Tap a dish to open its
        matrix (below). A recipe can also be linked from its own page: <strong>Used on menus</strong> lists the
        dishes that use it, and <strong>Link a dish</strong> links one for every venue.
      </P>
      <P>
        To save typing, Macaroonie matches dishes with no recipe to recipes by product code, then by name, and
        offers <strong>Link 14 dishes to their recipes</strong>. It opens a list to check: sure matches are
        ticked, untick any that are wrong, then <strong>Save</strong>. Retail goods whose barcode is the barcode
        of a stock item are offered <strong>Link 6 goods to their stock items</strong>: each gets a recipe of one
        of that item. Services need no recipe. When a menu is copied, its dishes keep their links. A link whose
        dish has gone from every menu shows under <strong>No longer on a menu</strong> and is removed after 30
        days; if the dish comes back in that time it keeps its link.
      </P>
      <H3>The matrix: a recipe by venue, revenue stream and order type</H3>
      <P>
        A dish&apos;s matrix has a row for every venue, then each venue with its revenue streams (the bar, the
        terrace) under it, and a column for any order type, then each one (eat in, take out, delivery...). Each
        cell shows the recipe the dish uses there and, with Costing access, what a portion costs at that
        venue and its cost %. A cell with a solid border is <strong>set here</strong>; a dashed one is{' '}
        <strong>inherited</strong> and says which cell it comes from; a yellow one has no recipe yet.
      </P>
      <P>
        The closest setting wins, the same way the VAT on a dish is decided: a revenue stream beats an order type,
        an order type beats a venue, and a venue beats every venue (an order type at a venue beats both). For
        example, your burger uses <strong>Burger</strong> for every venue. Set the <strong>Every venue, Take
        out</strong> cell to its variation <strong>Burger to go</strong> (two buns, a box) and every takeaway
        burger is costed that way. Soho makes it its own way: set <strong>Soho, any order type</strong> to{' '}
        <strong>Burger Soho</strong>. Soho takeaways still use Burger to go, because an order type is closer than
        a venue; if Soho&apos;s takeaway differs too, set <strong>Soho, Take out</strong>. A double burger can use
        the same recipe with <strong>Portions</strong> 2.
      </P>
      <P>
        Tap a cell to change it: the recipe&apos;s own variations come first, then any recipe, and the portions.
        Each cell has its own <strong>Save this cell</strong>. To clear a set cell tap it, tap the bin and confirm:
        it then follows the next closest cell. On a phone the matrix is a list per venue.
      </P>
      <H3>Options</H3>
      <P>
        An option changes what goes into a dish: extra cheese adds 30 g of cheddar, oat milk swaps the milk, large
        is the recipe times 1.5, a side of fries is the fries recipe, well done changes nothing. The{' '}
        <strong>Options</strong> tab lists every option in your option groups with what it does. Open one to give
        it a rule: <strong>Adds</strong> (an item or a prep recipe, how much), <strong>Takes out</strong> (an
        item), <strong>Swaps</strong> (an item for another, the same amount or a stated one),{' '}
        <strong>Scales</strong> (the recipe times a number), <strong>Is a recipe</strong> (a side) or{' '}
        <strong>Changes nothing</strong>, then <strong>Save rule</strong>. One dish can have its own rule for an
        option (from the option, or from the dish&apos;s matrix, where its one-off options are too). A rule acts
        on whichever recipe the dish uses there, so oat milk has nothing to swap in a takeaway version made
        without milk.
      </P>
      <P>
        An option with no rule follows its group&apos;s type (set on the option group): an option that{' '}
        <strong>adds to the recipe</strong> or is a <strong>side</strong> needs a rule and is marked{' '}
        <strong>Needs a rule</strong> until it has one; one that changes the dish changes nothing. The till&apos;s
        No, Light and Extra act on the option&apos;s own ingredient: No onion takes the recipe&apos;s onion out (found
        by name when the option has no rule), Light halves it, Extra doubles it; On the side changes nothing.
      </P>
      <H3>Menu margins</H3>
      <P>
        <strong>Menu margins</strong> (main menu, under Stock) shows every dish on a menu with its price, the price
        net of VAT, what it costs, its gross profit (GP) and cost %. Pick the menu, the venue (its prices), a
        revenue stream if you like, the order type, and <strong>Live</strong> (what tills and online sell now) or{' '}
        <strong>Draft</strong> (the menu as it is being edited). A dish has one price on a menu; its VAT changes
        with the order type (take out is often zero rated), so the same burger can have two margins. Each dish is
        costed with the recipe its matrix picks there.
      </P>
      <P>
        Dishes that can&apos;t be costed are listed first with how to fix each: they are never hidden. Options
        that cost extra show their own margin under their dish (extra cheese sells at 80p and costs 24p). A meal
        deal shows the range of its cost by what is picked in it. Sort by cost %, GP, name or section. Tap a dish
        to see why: which recipe and why, each step of its cost, the price and VAT, and a link to its matrix.{' '}
        <strong>Export CSV</strong> downloads the list.
      </P>
      <H3>Cost targets</H3>
      <P>
        Cost % is coloured against two figures: at or under the <strong>target</strong> is green (on target), up
        to the <strong>limit</strong> is amber (over target), above the limit is red (over the limit). They start
        at 30% and 35%. People with Costing manage change them in the <strong>Cost targets</strong> card at the
        bottom of Menu margins, and can give a menu section its own (drinks often run lower), then{' '}
        <strong>Save</strong>.
      </P>
      <InfoBox type="tip">
        Ask Pepper &ldquo;what does the burger cost to take away at Soho?&rdquo;, &ldquo;which dishes on the lunch
        menu are over target?&rdquo;, &ldquo;which recipes aren&apos;t fully costed?&rdquo; or &ldquo;what goes into the
        cheese sauce?&rdquo;. Reports has <strong>Dishes over the target cost %</strong>, <strong>Dishes with no
        recipe</strong>, <strong>Recipe cost by venue</strong> and <strong>Recipes not fully costed</strong> (under
        Recipes and costing).
      </InfoBox>
    </section>
  )
}
