# Macaroonie hub

The small service that runs in each restaurant for the POS, on a mini PC next to the
printers: it prints to the network printers and to USB printers plugged into it, tells the
cloud how they are, shows its own page on the venue's network and updates itself. Keeping
the tills in sync and trading with the internet down come later. Design: [`docs/POS.md`](../docs/POS.md).

- `bin/hub.js`: the hub. Shows a link code until linked, then prints. `status` prints what
  the running hub shows; `--self-test` checks a copy works (updates use it).
- `bin/launcher.js`: keeps an installed hub running (copied to `<home>/launcher.mjs`): runs
  the version in `current.json`, starts it again after an update, goes back to the version
  before when a new one keeps stopping.
- `src/cloud.js`: the hub's side of `/pos-api` (link code, config, collect, report).
- `src/service.js`: the print loop: collects every 2 s, prints, reports; asks each printer
  how it is every minute; tries a printer's backup when it doesn't answer; updates at a
  quiet moment.
- `src/usb.js`: printers plugged into this computer: Linux USB printers (`/dev/usb/lp*`,
  found by their USB ids, not their device file) and printers installed in Windows (a RAW
  job through the print spooler).
- `src/printer.js`: network printers over TCP port 9100, one job at a time per printer, with
  retries; asks the printer for its status.
- `src/escpos.js`: turns a ticket into Epson ESC/POS bytes (code page 1252 for £).
- `src/update.js`: downloads a new version from the cloud, checks it, unpacks it, tests it
  and switches to it.
- `src/statusPage.js`: the hub's page, `http://<this computer>:9180`.
- `install/install.sh`, `install/install.ps1`: the installers the cloud serves (with its
  address filled in) at `/pos-api/hub/install.sh` and `/pos-api/hub/install.ps1`.
- `install/setup.cmd`: the Windows file people download from `pos.<domain>/hub` and
  double-click (served as `macaroonie-hub-setup.cmd`); it asks to run as administrator,
  runs `install.ps1` and opens the hub's page.
- `../shared/pos/tickets.js`: the kitchen ticket and receipt layouts (shared with the
  cloud and the tills).
- `bin/test-print.js`: prints a sample kitchen ticket and receipt.
- `test/`: tests against a fake network printer, stand-in USB printers, a stand-in cloud
  and PowerShell (`npm test` in this folder).

No packages to install: it uses Node's own modules only.

## Setting up a mini PC

A fanless mini PC (for example an Intel N100 with 8 GB and a wired network port) with
Ubuntu or Debian Linux, or Windows 10 / 11, on a cable to the router, with a fixed address
on the router. Plug USB receipt printers into it.

**The easy way.** On the mini PC, open `pos.macaroonie.com/hub` in the browser (Store tech
→ Venue hub shows the address) and press **Download the installer**:

- Windows: open `macaroonie-hub-setup.cmd` from the downloads. Windows warns about a file
  from the internet: **More info**, then **Run anyway**, then **Yes** to allow changes. When
  it has finished, the hub's page opens with the link code. Opened again on a hub, it asks
  what to do (below). Without asking, in a Command Prompt: `macaroonie-hub-setup.cmd keep`,
  `switch` or `uninstall`.
- Linux: `sh ~/Downloads/macaroonie-hub-setup.sh` in a terminal (it asks for the password
  itself).

Or with one command:

**Linux.** In a terminal on the mini PC (Store tech → Venue hub shows the
command with your address, and a Copy button):

```
curl -fsSL https://pos.macaroonie.com/pos-api/hub/install.sh | sudo sh
```

It installs its own Node.js in `/opt/macaroonie-hub/node`, makes a `macaroonie-hub` user
(in the `lp` group for USB printers), installs the hub as the systemd service
`macaroonie-hub`, and shows the link code. Its log: `journalctl -u macaroonie-hub -f`.
What it shows: `sudo -u macaroonie-hub /opt/macaroonie-hub/node/bin/node
/opt/macaroonie-hub/releases/*/hub/bin/hub.js status --config /opt/macaroonie-hub/hub.json`,
or its page. Without asking: `... | sudo sh -s -- --keep`, `--switch` or `--uninstall`
(add `--force` to go ahead with sales the cloud hasn't had yet: they are lost).

**Windows.** In PowerShell opened as administrator:

```
irm https://pos.macaroonie.com/pos-api/hub/install.ps1 | iex
```

It installs into `C:\ProgramData\Macaroonie\Hub` with its own Node.js, as a scheduled task
that starts with the computer (as SYSTEM) and starts again if it stops, opens port 9180 on
private networks, and shows the link code. Its log: `C:\ProgramData\Macaroonie\Hub\hub.log`.
A printer installed in Windows (install the printer's own driver first) shows in the
hub's list by its Windows name. Without asking: `$env:MACAROONIE_HUB_CHOICE = 'keep'`,
`'switch'` or `'remove'` (or `$env:MACAROONIE_HUB_UNINSTALL = '1'`), then the same `irm ... | iex`.
Every hub process is stopped before an update: ending the scheduled task only ends the
launcher, and a hub left running kept the ports and the old link.

**Then:** in Macaroonie, Store tech → Venue hub → **Link a hub** and type the code (or scan
the QR code on the hub's page with the installer app). Add the network printers (On the
network, their address) and the USB ones (Add it beside each printer the hub found). The hub
updates itself after that
(Update by itself, in the hub's settings), and goes back to the version before if a new
one doesn't run.

**Running the installer again.** On a computer that is already a hub, the installer says
which restaurant group and venue it is linked to and asks:

1. **Keep it** (Enter alone): updates it and keeps its link.
2. **Link it to another restaurant or venue**: the hub sends up whatever the cloud hasn't had
   yet (sales taken while the internet was down), leaves its venue (that restaurant's Store
   tech shows it Not linked), deletes that venue's files on the computer (`hub.json`,
   `venue.json`, `venue.log`, `printers.json`), and shows a new code. If sales are waiting and
   the cloud doesn't answer, it stops and changes nothing (type LOSE to go ahead anyway).
3. **Remove the hub** from the computer, leaving its venue the same way first.

One computer is one hub for one venue. Removed in Store tech, a hub forgets that venue's files
by itself and shows a new code.

**Running it by hand** (a copy of this repository, Node.js 22): `node hub/bin/hub.js
[--api https://pos.<your domain>] [--config hub.json] [--http-port 9180]`; `hub.js link-info`
says what it is linked to, `hub.js unlink [--force]` takes it off its venue (stop it first).
A copy run this way doesn't update itself (Store tech says when a new version is out).

## Trial 1: print on your Epson

1. **Find the printer's IP address.** On most Epson network printers (TM-m30, TM-T88),
   press the small status button on the back for a few seconds; it prints a sheet with the
   IP address. Give the printer a fixed IP (a DHCP reservation on the router) if it hasn't one.
2. **Use a computer on the same network** (the PC that will become the hub, or any Windows
   PC). Install **Node.js 22 LTS** from nodejs.org.
3. **Open this repository's folder** (GitHub Desktop: Repository, Show in Explorer), then open
   a terminal in it (right-click, Open in Terminal).
4. **Print:**

   ```
   node hub/bin/test-print.js 192.168.1.50
   ```

   Use your printer's address. Options:
   - `--cols 48` for a TM-m30 (80mm); the default 42 suits a TM-T88.
   - `--drawer` also opens the cash drawer plugged into the printer.
   - `--only kitchen` or `--only receipt` prints just one.
   - `--status` only asks the printer how it is (online, paper).
   - `--preview` shows the tickets as text, no printer needed.

5. **Check the paper:** £ signs print correctly; the table number is large; HOLD and
   ALLERGY show as white-on-black bars; prices line up on the right; the paper cuts after
   each ticket.

If it fails: check the printer is switched on and its address, that the computer is on the
same network (try `ping 192.168.1.50`), and that the printer's raw port 9100 is on (Epson's
web settings page, at the printer's address in a browser).
