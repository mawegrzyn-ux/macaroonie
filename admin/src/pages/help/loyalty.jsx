// src/pages/help/loyalty.jsx
// The Help page's "Loyalty" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, InfoBox, DataTable } from './parts.jsx'

export const id = 'loyalty'
export const label = 'Loyalty'
export const order = 350

// ── LOYALTY ────────────────────────────────────
export function Section() {
  return (
    <section id="loyalty" data-help="">
      <H2>Loyalty</H2>
      <P>
        Loyalty gives your guests points, stamp cards and rewards. They collect and spend them at
        every one of your locations that takes part: on the tills, the self-order kiosks and
        online ordering. Each guest has a card in a loyalty web app on your website, and can add it
        to Apple Wallet or Google Wallet. Open <strong>Loyalty</strong> in the main menu (under
        Customers). It has six tabs: Overview, Programme, Rewards, Stamp cards, Members and Wallet.
      </P>
      <InfoBox type="info">
        Loyalty starts switched off. Nothing reaches guests until you turn on{' '}
        <strong>Loyalty is on</strong> in the Programme tab and press Save.
      </InfoBox>

      <H3>Switching loyalty on</H3>
      <P>
        In <strong>Programme</strong>, give the programme the <strong>Name guests see</strong>{' '}
        (for example Ware Club) and turn on <strong>Loyalty is on</strong>. The{' '}
        <strong>Features</strong> card switches each part on or off on its own:
      </P>
      <DataTable
        head={['Feature', 'What it does']}
        rows={[
          ['Points', 'Guests earn points on what they spend.'],
          ['Stamp cards', 'Buy a set number of dishes, or visit a set number of times, to fill a card.'],
          ['Spend points on rewards', 'Guests swap points for rewards from your list.'],
          ['Apple Wallet / Google Wallet', 'The card in the guest\'s phone wallet, with its balance kept up to date.'],
          ['Loyalty web app', 'Guests join, sign in and see their card at /loyalty on your website.'],
          ['Macaroonie loyalty', 'Taking part in a Macaroonie-wide programme. Not available yet.'],
        ]}
      />
      <P>
        Every card on the Programme tab saves together with one <strong>Save</strong> at the
        bottom. <strong>Discard</strong> puts back what was saved.
      </P>

      <H3>Points and how they are earned</H3>
      <P>
        In the <strong>Points</strong> card choose <strong>What they&apos;re called</strong>{' '}
        (points, beans, stars), <strong>Points per pound</strong>, the{' '}
        <strong>Smallest spend that earns</strong>, an optional <strong>Welcome gift</strong>{' '}
        of points for joining, and whether <strong>Points run out</strong> after a number of
        months with nothing earned or spent (then the whole balance goes).
      </P>
      <P>
        Points are counted on what the guest paid: after discounts, without tips or service
        charge, and less any refund. A till order earns when its check is closed. An online order
        earns once it is paid, or collected if paid at the counter. A refund later takes back the
        points it covered, and an online order that is cancelled gives back any reward spent on it.
      </P>

      <H3>Where loyalty works</H3>
      <P>
        The <strong>Where it works</strong> card has a row for Tills, Self-order kiosks and Online
        ordering, each with <strong>Earn</strong> and <strong>Spend rewards</strong>. Keep{' '}
        <strong>Every venue takes part</strong> ticked, or untick it and pick the venues. A venue
        left out doesn&apos;t offer loyalty on its tills, kiosks or online ordering, but its
        guests&apos; cards still work at the others.
      </P>

      <H3>Rewards</H3>
      <P>
        In <strong>Rewards</strong>, <strong>Add a reward</strong>: <strong>Money off</strong>,{' '}
        <strong>Percent off</strong> or <strong>A free dish</strong> (pick which dishes or
        sections can be free). Give it a <strong>Points price</strong> to offer it for points, or
        leave it blank for a reward only stamp cards or staff give. You can also set the{' '}
        <strong>Smallest order it can go on</strong>, the most it <strong>Takes off</strong>,{' '}
        <strong>Where it can be used</strong> (tills, kiosks, online), and how long{' '}
        <strong>A held reward lasts</strong>. Drag the grips to set the order guests see. A reward
        that has already been used can&apos;t be deleted: switch it off instead.
      </P>

      <H3>Stamp cards</H3>
      <P>
        In <strong>Stamp cards</strong>, add a card. <strong>Stamps come from</strong> either a
        stamp for each dish (pick the dishes or sections that earn one) or a stamp for each
        visit. Set the <strong>Stamps to fill it</strong>, the{' '}
        <strong>Most stamps from one order</strong> if you want a cap, and the reward{' '}
        <strong>A full card gives</strong>. A full card gives its reward to the guest to hold and
        starts again; stamps beyond a full card carry on to the next one. Stamp cards only count
        while the Stamp cards feature is on.
      </P>

      <H3>How guests join and sign in</H3>
      <P>
        Guests use their card on your website&apos;s <strong>Loyalty</strong> page,{' '}
        <Mono>/loyalty</Mono>, and on the loyalty web app at{' '}
        <Mono>loyalty.macaroonie.com/your-web-address</Mono>. Set up your website address first
        (Website, Domain). The Overview tab shows both links. Guests type their email and get a
        six-digit code that works for 15 minutes; there is no password. A new guest then gives a
        name (and a phone number, if you ask for one in <strong>Joining</strong>) and must agree
        to the words in <strong>What guests agree to</strong>. The newsletter box is optional and
        never ticked for them.
      </P>
      <P>
        Their card shows a QR code and member number, their points, stamp cards, rewards and
        history, and the Add to Apple Wallet / Add to Google Wallet buttons. Under{' '}
        <strong>Settings</strong> they can change their details and newsletter choice, download
        their data, get a new card code, or leave and delete their account. Guests can add the web
        app to their phone&apos;s home screen.
      </P>
      <P>
        Sign-in codes are emailed through your email settings (Booking emails, Settings), from the
        location used by your website&apos;s booking widget, or else one with email settings.
      </P>

      <H3>Joining at the till, or added by staff</H3>
      <P>
        On the till, open a check&apos;s actions and tap the programme&apos;s name, then{' '}
        <strong>Not a member yet?</strong>. Type their name and email (phone optional), read the
        words on screen to the guest, tick <strong>The guest agrees</strong> and tap{' '}
        <strong>Join and add to the check</strong>. Tick the newsletter only if they ask for it.
        They get an email with their card. Staff with access to Members can also add someone in
        the Members tab.
      </P>

      <H3>Loyalty on the till</H3>
      <P>
        On a check, open its actions and tap the programme&apos;s name. Scan the QR code on the
        guest&apos;s phone (a scanner or the camera), or search by email, phone, name or member
        number. An email has to be typed in full. Tap the member to put them on the check: their
        name shows in the check&apos;s header. Under <strong>Their rewards</strong>,{' '}
        <strong>Use</strong> puts a reward&apos;s discount on the check and{' '}
        <strong>Take off</strong> puts it back. Take their rewards off before removing the member.
        Points and stamps arrive when the check is closed.
      </P>

      <H3>Loyalty on the kiosks</H3>
      <P>
        On the kiosk&apos;s order page, guests tap <strong>Loyalty card</strong> and hold the QR
        code on their phone under the scanner, or use the camera. A kiosk is a public screen, so it
        finds members by their card only and shows just their first name. They can use rewards on
        the order, and the kiosk says what the order earns. A reward that no longer fits the order
        (a free dish taken out of the basket) is left off and says why. Guests who aren&apos;t
        members can scan a code on the screen to join on their phone. Starting again takes the
        card off.
      </P>

      <H3>Loyalty in online ordering</H3>
      <P>
        At checkout, guests first choose <strong>How would you like to order?</strong>:{' '}
        <strong>Sign in or join</strong> your programme (it says what the order earns) or{' '}
        <strong>Continue as a guest</strong>. The rest of checkout shows once they have chosen.
        Members sign in with the same emailed code as the web app, or join there and then; their
        name, email and phone fill in Your details. Signed in, they see their points and what the
        order earns, and can tap <strong>Use</strong> on their rewards. A guest who chose to order as
        a guest isn&apos;t asked again on that visit and can still tap{' '}
        <strong>Sign in or join instead</strong>. A guest already signed in on your website or the
        web app skips the question. <strong>Not you? Sign out</strong> clears the details the card
        filled in and asks again.
      </P>

      <H3>The Loyalty page on your website</H3>
      <P>
        Page builder, <strong>Pages &amp; modals</strong> always lists <strong>Loyalty</strong>, your
        loyalty page at <Mono>/loyalty</Mono> (marked <em>Loyalty</em>), the address on receipts,
        kiosks and wallet cards. Design it like any other page: it holds the{' '}
        <strong>Loyalty card</strong> block, and you can add a heading, text or photos around it.
        You can rename it, but it always stays at <Mono>/loyalty</Mono>, stays published and
        can&apos;t be deleted. It shows only while loyalty and its web app are switched on; at other
        times the address says loyalty isn&apos;t open.
      </P>

      <H3>The Loyalty card block</H3>
      <P>
        The <strong>Loyalty card</strong> block is the guest&apos;s own card on your website.
        Signed out, it shows the programme&apos;s name, how points and stamps are earned and the
        email sign-in or join. Signed in, it shows their QR card with their points and member
        number, stamp cards, rewards, wallet buttons, and the History and Settings tabs. It is on
        the Loyalty page and can go on any other page too. In its settings you can set a heading
        (blank: the programme&apos;s name, shown until they sign in; a heading of your own shows on
        the card too), the words above the sign-in, which parts show (How it works, Stamp cards,
        Rewards, Wallet buttons, History tab, Settings tab), the width (Narrow, Boxed, Wide), the
        button and box colours, and the card&apos;s colours (blank: the ones set in Programme). In
        the builder, tap <strong>Signed out</strong> or <strong>Signed in</strong> above the
        block to see a sample of each. Signing in on one block (or at checkout) signs the guest in
        on every block on that browser.
      </P>

      <H3>The Loyalty website block</H3>
      <P>
        In the page builder, add the <strong>Loyalty</strong> block to any page. It shows the
        programme&apos;s name, how points and stamps are earned, the three cheapest rewards and a
        button to <Mono>/loyalty</Mono>. In its settings you can change the heading, text and
        button words, hide the rewards, and pick Banner or Card and colours. The block hides itself
        while loyalty or the web app is switched off.
      </P>

      <H3>Wallet cards</H3>
      <P>
        Cards use Macaroonie&apos;s Apple Wallet and Google Wallet accounts and your brand&apos;s
        colours (change them in Programme, <strong>The card&apos;s colours</strong>). An owner or
        admin can use your own accounts instead in the <strong>Wallet</strong> tab: for Apple your
        Pass Type ID, Team ID, pass certificate, private key and Apple&apos;s WWDR certificate;
        for Google your issuer ID and a service account key file. A wallet card&apos;s balance
        updates within about a minute of a change.
      </P>
      <H3>Card looks members pick</H3>
      <P>
        In Programme, <strong>Card looks members can pick</strong> offers up to eight looks for the card, each a
        name and its background, words and highlight colours. <strong>Add a look</strong> starts from a ready-made
        one you can change; drag them into the order members see. Members then choose a look for their own card in
        the loyalty app&apos;s <strong>Settings</strong> (or keep <strong>Standard</strong>, the card&apos;s colours
        above), and their card shows it in the app, on your website and in Apple and Google Wallet. Take a look away
        and the members who picked it go back to the standard look. With no looks set, members see no choice.
      </P>

      <H3>Members</H3>
      <P>
        The <strong>Members</strong> tab lists your members, searchable by name, email, phone or
        member number, with filters for status, newsletter and tag. <strong>CSV</strong> downloads
        the list. Open a member to:
      </P>
      <DataTable
        head={['Action', 'What happens']}
        rows={[
          ['Profile', 'Change name, email, phone, the newsletter (only the guest can tick it), staff-only notes and tags.'],
          ['Points', 'Add or take away points, with a reason. Shows in their history.'],
          ['Give a reward', 'Gives them a reward to hold, with a note. A given reward can be taken back while unused.'],
          ['Put it back', 'For a reward taken out on a till or kiosk but never used: the points or reward return.'],
          ['New card code', 'The old QR code stops working. Use it when someone else has a photo of theirs.'],
          ['Close membership', 'Their card stops working on tills and kiosks and they are signed out of the web app. Open again undoes it.'],
        ]}
      />
      <P>
        Two permissions in Modules &amp; Roles control this: <strong>Loyalty</strong> (programme,
        rewards, stamp cards, wallet) and <strong>Loyalty members</strong> (the members list, which
        holds personal data).
      </P>

      <H3>Members&apos; data and GDPR</H3>
      <P>
        <strong>Download their data</strong> gives a member&apos;s details and full history as a
        file. <strong>Erase this member</strong> (owner or admin, type ERASE) clears their name,
        email, phone, notes, tags and consents, stops their card and wallet cards, and cancels
        rewards they hold. The points history stays, without anything that names them, so your
        figures still add up. Guests can do both themselves in the web app. Anonymising a customer
        on the Customers page also erases their loyalty membership.
      </P>
    </section>
  )
}
