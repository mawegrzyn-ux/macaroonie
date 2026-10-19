# Macaroonie hub

The small service that runs in each restaurant for the POS: it prints to the
network printers, keeps the tills in sync and keeps the venue trading when the
internet is down. Design: [`docs/POS.md`](../docs/POS.md).

It prints (migration 191): it collects the tickets queued for the venue's network
printers, prints them and tells the cloud how each printer is. Keeping the tills in sync
and trading with the internet down come later.

- `bin/hub.js`: the hub itself. Links to the venue with a code, then prints.
- `src/cloud.js`: the hub's side of `/pos-api` (link code, config, collect, report).
- `src/service.js`: the print loop: collects every 2 s, prints, reports; asks each printer
  how it is every minute; tries a printer's backup when it doesn't answer.
- `src/escpos.js`: turns a ticket into Epson ESC/POS bytes (code page 1252 for £).
- `src/printer.js`: sends a job to a printer over TCP port 9100, one job at a time per
  printer, with retries; asks the printer for its status.
- `../shared/pos/tickets.js`: the kitchen ticket and receipt layouts (shared with the
  cloud and the tills).
- `bin/test-print.js`: prints a sample kitchen ticket and receipt.
- `test/`: tests against a fake network printer and a stand-in cloud (`npm test` in this folder).

No packages to install: it uses Node's own modules only.

## Running the hub

1. On a PC (or mini PC) on the venue's network, next to the printers, install **Node.js 22
   LTS** and copy this repository (or just `hub/` and `shared/`) onto it.
2. Run `node hub/bin/hub.js` (add `--api https://pos.<your domain>` if it isn't
   `pos.macaroonie.com`). It shows a six-letter code.
3. In Macaroonie: **Till setup → Printers → Link a hub**, type the code and a name.
   The hub keeps its link in `hub/hub.json` (keep that file private; `--config` puts it
   elsewhere). `--forget` links it again with a new code.
4. Add the network printers on the same tab (on the network, with their IP address). The
   hub picks them up within a minute and shows how each is on the printer's row.
5. To keep it running, make it a service: on Windows with NSSM or Task Scheduler (at
   start-up, restart on failure), on Linux a systemd unit running the same command.

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
