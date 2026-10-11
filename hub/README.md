# Macaroonie hub

The small service that runs in each restaurant for the POS: it prints to the
network printers, keeps the tills in sync and keeps the venue trading when the
internet is down. Design: [`docs/POS.md`](../docs/POS.md).

It is at **Phase 0**: only the printing trial is here so far.

- `src/escpos.js`: turns a ticket into Epson ESC/POS bytes (code page 1252 for £).
- `src/printer.js`: sends a job to a printer over TCP port 9100, one job at a time per
  printer, with retries; asks the printer for its status.
- `../shared/pos/tickets.js`: the kitchen ticket and receipt layouts (shared with the
  cloud and the tills).
- `bin/test-print.js`: prints a sample kitchen ticket and receipt.
- `test/`: tests against a fake network printer (`npm test` in this folder).

No packages to install: it uses Node's own modules only.

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
