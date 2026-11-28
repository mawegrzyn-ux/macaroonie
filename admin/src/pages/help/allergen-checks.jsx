// src/pages/help/allergen-checks.jsx
// The Help page's "Allergens from recipes" section (inventory phase 8a,
// 27 Nov 2026): allergens on supplier products (and Pepper reading them off a
// spec sheet), the Recipes page's Allergens tab with accept and dismiss, the
// recipe editor's suggestion, Pepper's allergen_check and the reports.
// Phase 8b (27 Nov 2026): checks opened again when something changes and
// Today's "Allergen checks to review", a substitute on a delivery, and
// suggested calories (an item's energy, the Calories card, calorie labelling).
// Help.jsx gathers every file in this folder (except parts.jsx) and shows them
// by order, then id.
import { H2, H3, P, InfoBox, DataTable } from './parts.jsx'

export const id = 'allergen-checks'
export const label = 'Allergens and calories from recipes'
export const order = 376.7

export function Section() {
  return (
    <section id="allergen-checks" data-help="">
      <H2>Allergens and calories from recipes</H2>
      <P>
        What a dish declares on its menu (the Allergen matrix) is what guests are told. Macaroonie can check that
        declaration against what the dish is really made of: the allergens of each ingredient&apos;s supplier product,
        through the dish&apos;s recipe, the prep recipes inside it and what its options add. Where they differ, the
        Recipes page says so, and a person decides.
      </P>
      <InfoBox type="warn">
        Your business is responsible for what each dish declares. The check is only as good as the supplier data under
        it: a product whose spec sheet is out of date, or a substitute delivered instead, can make it wrong. It suggests;
        nothing here changes what a dish declares by itself.
      </InfoBox>
      <H3>Put in each product&apos;s allergens</H3>
      <P>
        Two suppliers&apos; soy sauces can differ, so allergens are kept on each <strong>supplier price</strong>, not on the
        item. On the <strong>Inventory</strong> page, open an item and tap <strong>Allergens</strong> on a supplier price:
        set each of the 14 allergens to Contains, May contain or No, say where it came from (the spec sheet and its date)
        and tap <strong>Save</strong>. Until someone saves them, a product&apos;s allergens are <em>not known yet</em>, never
        &quot;free from&quot;: the row says so in amber.
      </P>
      <P>
        With Pepper switched on, <strong>Read the spec sheet</strong> takes a PDF or a photo of the sheet or the label.
        Pepper answers each of the 14 with contains, may contain, free from or not said, with the words it read. Tap{' '}
        <strong>Use this reading</strong> to put it in the form, check it against the sheet (anything the sheet
        didn&apos;t mention is set to No: look at those), then Save. Nothing is saved until you do, and the file isn&apos;t
        kept. Putting allergens in needs Purchasing setup manage, and Pepper offers to read a sheet only to people who have it.
      </P>
      <H3>The Allergens tab</H3>
      <P>
        <strong>Recipes</strong>, tab <strong>Allergens</strong>, lists every food dish on your menus, the ones with open
        differences first. Pick a venue to see only the dishes sold there. A dish&apos;s suggestion is worked out at each
        venue with the supplier product that venue orders (its own choice, else the group&apos;s, else the cheapest), with
        the recipe the dish uses there, so a venue on another supplier, or a takeaway version, can suggest something else;
        the check shows each where they differ.
      </P>
      <DataTable
        head={['A dish shows', 'When']}
        rows={[
          ['Open', 'Its recipes and its declaration differ, and nobody has decided yet'],
          ['Not all known', 'Nothing differs among the ingredients whose allergens are known, but some aren\'t known yet. This is never a pass: put the missing allergens in and it is worked out again'],
          ['Dismissed', 'Someone kept the declaration as it is, with a note'],
          ['Accepted', 'Someone changed the declaration to match'],
          ['Agrees', 'Every ingredient\'s allergens are known, and they match what the dish declares'],
          ['Can\'t check yet', 'The dish has no recipe linked'],
        ]}
      />
      <P>
        Until your supplier products have their allergens put in, most dishes show <strong>Not all known</strong>: a dish
        with nothing known is never shown as agreeing, and its suggestion reads &quot;Not known yet&quot;, not &quot;none of
        the 14&quot;.
      </P>
      <DataTable
        head={['It says', 'Which means', 'Accepting']}
        rows={[
          ['The recipe has sesame; the dish does not say so', 'An ingredient contains it, at one venue or more', 'declares it as contains'],
          ['The recipe may contain sesame; the dish does not say so', 'A product says it may contain it', 'declares it as may contain'],
          ['The recipe has sesame; the dish says only may contain', 'The declaration is weaker than an ingredient', 'declares it as contains'],
          ['The dish declares celery; nothing in the recipe has it', 'No product at any venue has it, and every product is known', 'takes it off'],
          ['The dish says it contains sesame; the recipe only may contain it', 'Every product only may contain it', 'declares it as may contain'],
        ]}
      />
      <P>
        Open a dish to see the evidence: which ingredient (inside which prep recipe, or with which option) and which
        supplier&apos;s product says so, at which venues. <strong>Not known yet</strong> lists what stops the check being
        complete: an ingredient whose product has no allergens put in (&quot;allergens unknown for oyster sauce at
        Soho&quot;), an ingredient with no supplier price, a recipe Pepper read in that nobody has checked, an option that
        adds something with no rule, a venue with no recipe. While anything is unknown, an allergen the dish declares
        that nothing known has is not called out: the unknown product may hold it.
      </P>
      <H3>Accept or dismiss</H3>
      <P>
        With Recipes manage and Menus manage, tick the differences you agree with and tap <strong>Accept</strong>, then{' '}
        <strong>Yes, change the draft</strong>. The dish&apos;s allergens change in the menu&apos;s <strong>draft</strong>,
        exactly as the Allergen matrix would save them; guests still see the old declaration until you publish the
        menu&apos;s allergens (Menus, Allergen matrix, Publish). The check shows &quot;draft not live yet&quot; until then.
        Differences you didn&apos;t tick stay open: the check shows them again on their own, and accepting them is a new
        Accept with its own Yes. Only what you ticked, of what differs when you tap Yes, is accepted. Without Menus manage
        the check says so in place of Accept and Dismiss.
      </P>
      <P>
        If the declaration is right as it is, tap <strong>Dismiss</strong> and say why (&quot;celery salt is in the
        garnish, not the recipe&quot;). A dismissal holds until the differences change: a new product, a recipe change or
        a new allergen on a spec sheet that makes a new difference opens the check again, with the earlier decision kept
        under <strong>Decisions</strong>. <strong>Open it again</strong> takes a dismissal back. Discarding the menu&apos;s
        draft changes before they are published opens an accepted check again.
      </P>
      <H3>When something changes</H3>
      <P>
        A change that could alter what a dish holds works its check out again straight away: a supplier price added,
        changed, switched off or deleted (another product can become the cheapest), a venue&apos;s own price, a
        product&apos;s allergens saved, the usual supplier switched, a supplier switched off or on, a product substituted on
        a delivery, a recipe saved, which recipe a dish uses, or an option&apos;s rule. Only the dishes that use what changed
        are looked at again, through their prep recipes and the options that add it.
      </P>
      <P>
        If that makes a new difference, the check opens (a dismissed or accepted one opens again, its decision kept under{' '}
        <strong>Decisions</strong>) and says what changed: &quot;Oyster sauce: the usual supplier switched at Leeds&quot;. If
        nothing it decided changes, a dismissal holds. Checks a change opened go on <strong>Today</strong> as{' '}
        <strong>Allergen checks to review</strong>, at each venue that sells the dish, for whoever can decide them (Recipes
        manage and Menus manage). The card opens the Allergens tab on <strong>Changed</strong>, and leaves Today once each is
        accepted or dismissed. A new change after you skip or finish the card brings it back.
      </P>
      <H3>A substitute on a delivery</H3>
      <P>
        When you book a delivery in and mark a line <strong>Substituted</strong>, what came may hold other allergens, so
        for 14 days (or until the item is delivered as ordered again) it counts at that venue as well as the usual product.
        Until it is a supplier price with its allergens, it is unknown: the check says &quot;a substitute for rice noodles
        was delivered at Soho: its allergens aren&apos;t known&quot;. On the delivery, <strong>Update the price list</strong>,{' '}
        <strong>Add</strong> makes what came a supplier price (from the invoice&apos;s code and name); put its allergens in on
        the Inventory page and the check uses them.
      </P>
      <H3>In a recipe</H3>
      <P>
        The recipe editor shows <strong>Suggested allergens</strong>: what the recipe holds from its saved lines and prep
        recipes inside, at each venue&apos;s supplier products (venues that agree together), and what isn&apos;t known yet.
        A suggestion only: a recipe doesn&apos;t declare anything. Below it, <strong>Suggested calories</strong>: the
        recipe&apos;s own figure (a portion, or one of what a prep recipe makes) and each dish linked to it with what its
        menu declares, with <strong>Check it</strong> where they differ.
      </P>
      <H3>Calories</H3>
      <InfoBox type="warn">
        Calorie labelling on menus applies in England to businesses with 250 or more employees, and a franchise counts the
        employees of the whole network, not one venue. Confirm the detail for your business (who it covers, what must be
        shown and where) before relying on it. The figures here are worked out from your recipes and each item&apos;s
        energy: they are only as good as those.
      </InfoBox>
      <P>
        Give each item its <strong>energy</strong> on the Inventory page (open the item, <strong>Units, yield and
        energy</strong>): kcal per 100 g for an item kept in grams, per 100 ml for one kept in millilitres, or for one item
        kept in each, of the part that goes into a recipe (after trimming), with where it came from (the label, the spec
        sheet, a food table). Tap <strong>Save</strong>. Empty means not known.
      </P>
      <P>
        Each dish&apos;s check on the Allergens tab has a <strong>Calories</strong> card: what its menu declares beside what
        one serving of its recipe comes to (the recipe&apos;s ingredients, through its prep recipes, a batch&apos;s energy
        shared over what it makes after cooking, times the portions the dish is linked at; options and extras are not
        counted). At several venues with different recipes, the suggestion is the highest, with the range said. A declared
        figure within 10% (at least 10 kcal) agrees: that is the app&apos;s rule of thumb for a figure worked out from
        recipes, not a legal tolerance. <strong>What gives the most</strong> lists the ingredients behind it.
      </P>
      <DataTable
        head={['It says', 'Which means']}
        rows={[
          ['The recipe comes to 640 kcal; the dish declares no calories', 'Every energy is known and the menu has no figure'],
          ['The recipe comes to 640 kcal; the dish declares 500 kcal', 'They differ by more than 10%'],
          ['What is known already comes to more than the 100 kcal the dish declares', 'Some energy isn\'t known, but what is known is already more than declared'],
          ['Not all known', 'An ingredient has no energy, a quantity is in a unit with no size, or a recipe is missing: there is no suggestion yet'],
        ]}
      />
      <P>
        With Recipes manage and Menus manage, <strong>Accept</strong> (then <strong>Yes, change the draft</strong>) writes the
        suggested figure into the dish on the menu&apos;s <strong>draft</strong>; guests see it once the menu is published.
        There is nothing to accept while anything is unknown. <strong>Dismiss</strong> keeps the declared figure, with why
        (&quot;lab tested at 640 kcal&quot;): it holds while the recipe stays within 10% of the figure then, and opens again
        (on Today too) when an ingredient&apos;s energy, a recipe or a link moves it past that. The{' '}
        <strong>Calories</strong> filter lists the dishes whose figure differs.
      </P>
      <H3>Pepper and reports</H3>
      <P>
        Ask Pepper &quot;does the pad thai&apos;s declaration match its recipe?&quot;: it gives the declaration, the
        suggestion, what differs with the evidence, and what is unknown. It never answers a guest&apos;s allergy question
        from this: &quot;which dishes are free from sesame?&quot; is still answered from what the live menu declares.
        While any ingredient is unknown it says so (&quot;not all known&quot;), never that the dish agrees. Attach a
        product&apos;s spec sheet in the chat and ask Pepper to read its allergens (Purchasing setup manage): it shows a card
        with what it read, saves it on the supplier price when you confirm, and links to the Inventory page searched for
        the item.
      </P>
      <P>
        In Reports, the starters <strong>Dishes with allergen differences</strong> (open checks, as last worked out on the
        tab) and <strong>Items with unknown allergens</strong> (supplier products in use, of items in recipes, nobody has
        put allergens in for; an item with no supplier price at all shows on the Allergens tab, not here), and the subject{' '}
        <strong>Allergen checks</strong> (with what changed). Supplier prices also carry each product&apos;s
        allergens. For calories: the starters <strong>Dishes with calorie differences</strong> and <strong>Items with no
        energy figure</strong>, the subject <strong>Calorie checks</strong>, and the energy fields on Inventory items.
      </P>
    </section>
  )
}
