// src/pages/help/allergen-checks.jsx
// The Help page's "Allergens from recipes" section (inventory phase 8a,
// 27 Nov 2026): allergens on supplier products (and Pepper reading them off a
// spec sheet), the Recipes page's Allergens tab with accept and dismiss, the
// recipe editor's suggestion, Pepper's allergen_check and the reports.
// Help.jsx gathers every file in this folder (except parts.jsx) and shows them
// by order, then id.
import { H2, H3, P, InfoBox, DataTable } from './parts.jsx'

export const id = 'allergen-checks'
export const label = 'Allergens from recipes'
export const order = 376.7

export function Section() {
  return (
    <section id="allergen-checks" data-help="">
      <H2>Allergens from recipes</H2>
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
      <H3>In a recipe</H3>
      <P>
        The recipe editor shows <strong>Suggested allergens</strong>: what the recipe holds from its saved lines and prep
        recipes inside, at each venue&apos;s supplier products (venues that agree together), and what isn&apos;t known yet.
        A suggestion only: a recipe doesn&apos;t declare anything.
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
        <strong>Allergen checks</strong>. Supplier prices also carry each product&apos;s
        allergens.
      </P>
    </section>
  )
}
