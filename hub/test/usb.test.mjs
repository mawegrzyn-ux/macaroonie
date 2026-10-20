// Printers plugged into the hub's computer (src/usb.js): Linux USB printers
// found in a stand-in sysfs and printed by writing to their device file,
// found again by id when their device file changes; Windows printers listed
// and printed through a stand-in PowerShell (the RAW job script, the printer
// name and the exact bytes). Run: cd hub && npm test

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { findPrinters, printLocal, localStatus, usbSystem, parse1284, windowsStatus, PS_LIST, PS_PRINT } from '../src/usb.js'

/** A stand-in sysfs and /dev: printers [{ lp, port, vendor, product, serial, id1284 }]. */
function fakeLinux(printers) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-usb-'))
  const sys = path.join(root, 'sys')
  const dev = path.join(root, 'dev')
  fs.mkdirSync(path.join(sys, 'class', 'usbmisc'), { recursive: true })
  fs.mkdirSync(path.join(dev, 'usb'), { recursive: true })
  for (const p of printers) {
    const usbDev = path.join(sys, 'devices', 'pci0000:00', 'usb1', p.port)
    const iface = path.join(usbDev, p.port + ':1.0')
    fs.mkdirSync(iface, { recursive: true })
    fs.writeFileSync(path.join(usbDev, 'idVendor'), p.vendor + '\n')
    fs.writeFileSync(path.join(usbDev, 'idProduct'), p.product + '\n')
    if (p.serial) fs.writeFileSync(path.join(usbDev, 'serial'), p.serial + '\n')
    if (p.product_name) fs.writeFileSync(path.join(usbDev, 'product'), p.product_name + '\n')
    if (p.id1284) fs.writeFileSync(path.join(iface, 'ieee1284_id'), p.id1284)
    fs.mkdirSync(path.join(sys, 'class', 'usbmisc', p.lp))
    fs.symlinkSync(iface, path.join(sys, 'class', 'usbmisc', p.lp, 'device'))
    fs.writeFileSync(path.join(dev, 'usb', p.lp), '')
  }
  return { root, sys: usbSystem({ platform: 'linux', sysRoot: sys, devRoot: dev }), dev }
}

test('the IEEE 1284 id a printer gives', () => {
  assert.deepEqual(
    { ...parse1284('MFG:EPSON;CMD:ESC/POS;MDL:TM-T20III;CLS:PRINTER;DES:EPSON TM-T20III Receipt;') },
    { MFG: 'EPSON', CMD: 'ESC/POS', MDL: 'TM-T20III', CLS: 'PRINTER', DES: 'EPSON TM-T20III Receipt' },
  )
  const long = parse1284('MANUFACTURER:Star;COMMAND SET:STAR;MODEL:TSP143;')
  assert.equal(long.MFG, 'Star')
  assert.equal(long.MDL, 'TSP143')
})

test('Linux: printers found by id, printed by writing their device file, found again when the file changes', async () => {
  const f = fakeLinux([
    { lp: 'lp0', port: '1-1', vendor: '04b8', product: '0e28', serial: 'X5ZF012345', id1284: 'MFG:EPSON;CMD:ESC/POS;MDL:TM-T20III;DES:EPSON TM-T20III;' },
    { lp: 'lp1', port: '1-2.3', vendor: '0416', product: '5011', product_name: 'POS58 Printer', id1284: 'MFG:;MDL:;' },
  ])
  const found = await findPrinters(f.sys)
  assert.deepEqual(found.map(p => [p.id, p.name, p.escpos, path.basename(p.path)]), [
    ['usb:04b8:0e28:X5ZF012345', 'EPSON TM-T20III', true, 'lp0'],
    ['usb:0416:5011:port-1-2.3', 'POS58 Printer', false, 'lp1'],
  ])

  const data = Buffer.from([0x1b, 0x40, 0x41, 0x42, 0x0a, 0xa3])
  const r = await printLocal({ id: 'usb:04b8:0e28:X5ZF012345', data, sys: f.sys })
  assert.equal(r.name, 'EPSON TM-T20III')
  assert.deepEqual(fs.readFileSync(path.join(f.dev, 'usb', 'lp0')), data, 'the exact bytes reached the device file')

  // Jobs to one printer go one after another, in order.
  await Promise.all([1, 2, 3].map(n => printLocal({ id: 'usb:04b8:0e28:X5ZF012345', data: Buffer.from('job' + n), sys: f.sys })))
  assert.equal(fs.readFileSync(path.join(f.dev, 'usb', 'lp0'), 'latin1').slice(data.length), 'job1job2job3')

  // Plugged in the other way round: lp0 and lp1 swap, the id still finds the Epson.
  fs.rmSync(path.join(f.sys.sysRoot, 'class', 'usbmisc', 'lp0', 'device'))
  fs.rmSync(path.join(f.sys.sysRoot, 'class', 'usbmisc', 'lp1', 'device'))
  fs.symlinkSync(path.join(f.sys.sysRoot, 'devices', 'pci0000:00', 'usb1', '1-2.3', '1-2.3:1.0'), path.join(f.sys.sysRoot, 'class', 'usbmisc', 'lp0', 'device'))
  fs.symlinkSync(path.join(f.sys.sysRoot, 'devices', 'pci0000:00', 'usb1', '1-1', '1-1:1.0'), path.join(f.sys.sysRoot, 'class', 'usbmisc', 'lp1', 'device'))
  fs.writeFileSync(path.join(f.dev, 'usb', 'lp1'), '')
  await printLocal({ id: 'usb:04b8:0e28:X5ZF012345', data: Buffer.from('after swap'), sys: f.sys })
  assert.equal(fs.readFileSync(path.join(f.dev, 'usb', 'lp1'), 'latin1'), 'after swap')

  // A printer that can't answer how it is: reachable, state unknown.
  assert.equal(await localStatus({ id: 'usb:04b8:0e28:X5ZF012345', sys: f.sys }), null)

  // Unplugged: a clear reason, after its retries.
  await assert.rejects(printLocal({ id: 'usb:9999:0001:NOPE', data, sys: f.sys, attempts: 1 }), /Not plugged into the hub/)
  await assert.rejects(localStatus({ id: 'usb:9999:0001:NOPE', sys: f.sys }), /Not plugged into the hub/)
  fs.rmSync(path.join(f.dev, 'usb', 'lp1'))
  await assert.rejects(printLocal({ id: 'usb:04b8:0e28:X5ZF012345', data, sys: f.sys, attempts: 1 }), /lp1 isn't plugged in/)

  // No usbmisc class (no USB printers ever plugged in): an empty list.
  assert.deepEqual(await findPrinters(usbSystem({ platform: 'linux', sysRoot: path.join(f.root, 'nothing'), devRoot: f.dev })), [])
  fs.rmSync(f.root, { recursive: true, force: true })
})

/** A stand-in PowerShell: records each call, answers like Get-Printer, keeps the bytes a print job sent. */
function fakePowershell(printers) {
  const calls = []
  const spawn = (cmd, args, opts) => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = () => {}
    const script = Buffer.from(args[args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le')
    const call = { cmd, args, script, env: opts.env }
    calls.push(call)
    setImmediate(() => {
      if (script.includes('Get-Printer')) child.stdout.emit('data', JSON.stringify(printers))
      if (script.includes('MacaroonieRaw')) {
        if (opts.env.MACAROONIE_PRINTER === 'Broken') {
          child.stderr.emit('data', 'Exception calling "Send": The printer name is invalid\r\n')
          return child.emit('close', 1)
        }
        call.bytes = fs.readFileSync(opts.env.MACAROONIE_FILE)
      }
      child.emit('close', 0)
    })
    return child
  }
  return { calls, sys: usbSystem({ platform: 'win32', spawn }) }
}

test('Windows: printers listed from Get-Printer, printed as a RAW job through the spooler', async () => {
  const w = fakePowershell([
    { Name: 'EPSON TM-T20III Receipt', DriverName: 'EPSON TM-T20III Receipt5', PortName: 'ESDPRT001', PrinterStatus: 0 },
    { Name: 'Microsoft Print to PDF', DriverName: 'Microsoft Print To PDF', PortName: 'PORTPROMPT:', PrinterStatus: 0 },
    { Name: 'Kitchen', DriverName: 'Generic / Text Only', PortName: 'USB001', PrinterStatus: 5 },
    { Name: 'Broken', DriverName: 'POS-80', PortName: 'USB002', PrinterStatus: 8 },
  ])
  const found = await findPrinters(w.sys)
  assert.deepEqual(found.map(p => [p.id, p.escpos]), [['win:EPSON TM-T20III Receipt', true], ['win:Kitchen', false], ['win:Broken', true]], 'virtual printers left out')
  assert.equal(w.calls[0].cmd, 'powershell.exe')
  assert.ok(w.calls[0].args.includes('-NonInteractive') && w.calls[0].script.includes(PS_LIST))

  const data = Buffer.from([0x1b, 0x40, 0xa3, 0x31, 0x2e, 0x30, 0x30, 0x0a, 0x1d, 0x56, 0x42, 0x00])
  await printLocal({ id: 'win:EPSON TM-T20III Receipt', data, sys: w.sys })
  const job = w.calls.find(c => c.script.includes('MacaroonieRaw'))
  assert.equal(job.env.MACAROONIE_PRINTER, 'EPSON TM-T20III Receipt', 'the name goes in an environment variable, never in the script')
  assert.ok(!job.script.includes('EPSON TM-T20III Receipt'))
  assert.ok(job.script.includes('pDataType = "RAW"') && job.script.includes('WritePrinter'), 'a RAW job through winspool')
  assert.equal(job.script.trim().endsWith(PS_PRINT.trim()), true)
  assert.deepEqual(job.bytes, data, 'the exact bytes')
  assert.ok(!fs.existsSync(job.env.MACAROONIE_FILE), 'the temporary file is removed')

  await assert.rejects(printLocal({ id: 'win:Broken', data, sys: w.sys, attempts: 1 }), /printer name is invalid/)
  assert.deepEqual(await localStatus({ id: 'win:Kitchen', sys: w.sys }), { online: true, paperNearEnd: false, paperOut: true, coverOpen: false, error: null })
  assert.equal((await localStatus({ id: 'win:Broken', sys: w.sys })).online, false)
})

test('Windows printer states', () => {
  assert.equal(windowsStatus(0).online, true)
  assert.equal(windowsStatus(8).online, false)
  assert.equal(windowsStatus('Offline').online, false)
  assert.equal(windowsStatus(23).coverOpen, true)
  assert.equal(windowsStatus(5).paperOut, true)
  assert.equal(windowsStatus(11).online, true, 'printing is fine')
})
