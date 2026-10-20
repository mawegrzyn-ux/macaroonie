// hub/src/usb.js
//
// Printers plugged into the hub's own computer (a mini PC by the printers):
//
//   Linux    a USB receipt printer is a device file, /dev/usb/lp0, made by
//            the kernel's usblp driver. findPrinters() reads sysfs for its
//            make, model, USB ids and serial number; printing writes the
//            ESC/POS bytes straight to the file; status asks the printer
//            (DLE EOT) and reads its answer back. The hub's user must be in
//            the `lp` group (the installer adds it).
//   Windows  a printer installed in Windows (USB, serial, Bluetooth) is used
//            by its name: the bytes go to the print spooler as a RAW job
//            through PowerShell (winspool), so the driver doesn't touch them.
//
// A printer is found again by its id, never by its device file: lp0 and lp1
// swap when two printers are plugged in a different order. The id is
// usb:<vendor>:<product>:<serial> (or the USB port when the printer has no
// serial number) on Linux, win:<printer name> on Windows.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn as nodeSpawn } from 'node:child_process'
import { decodeStatus } from './printer.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * Where to look: real sysfs and /dev, or a stand-in folder in tests
 * (also HUB_SYS_ROOT / HUB_DEV_ROOT). `platform` decides Linux or Windows.
 */
export function usbSystem({
  platform = process.platform, sysRoot = process.env.HUB_SYS_ROOT || '/sys', devRoot = process.env.HUB_DEV_ROOT || '/dev', spawn = nodeSpawn,
} = {}) {
  return { platform, sysRoot, devRoot, spawn }
}

// ── Linux ────────────────────────────────────────────────────────────

function readText(file) {
  try { return fs.readFileSync(file, 'utf8').replace(/\0/g, '').trim() } catch { return '' }
}

/** "MFG:EPSON;CMD:ESC/POS;MDL:TM-T20III;..." -> { MFG, CMD, MDL, DES, ... } */
export function parse1284(id) {
  const out = {}
  for (const part of String(id || '').split(';')) {
    const i = part.indexOf(':')
    if (i > 0) out[part.slice(0, i).trim().toUpperCase()] = part.slice(i + 1).trim()
  }
  // Long names some printers use.
  out.MFG ||= out.MANUFACTURER || ''
  out.MDL ||= out.MODEL || ''
  out.CMD ||= out['COMMAND SET'] || ''
  out.DES ||= out.DESCRIPTION || ''
  return out
}

function linuxPrinters(sys) {
  const dir = path.join(sys.sysRoot, 'class', 'usbmisc')
  let names = []
  try { names = fs.readdirSync(dir).filter(n => /^lp\d+$/.test(n)).sort((a, b) => Number(a.slice(2)) - Number(b.slice(2))) } catch { return [] }
  const list = []
  for (const name of names) {
    const iface = path.join(dir, name, 'device')
    let usbDev = null
    try { usbDev = path.dirname(fs.realpathSync(iface)) } catch { continue }
    const ids = parse1284(readText(path.join(iface, 'ieee1284_id')))
    const vendor = readText(path.join(usbDev, 'idVendor')) || '0000'
    const product = readText(path.join(usbDev, 'idProduct')) || '0000'
    const serial = readText(path.join(usbDev, 'serial'))
    const port = path.basename(usbDev)
    const make = ids.MFG || readText(path.join(usbDev, 'manufacturer'))
    const model = ids.MDL || readText(path.join(usbDev, 'product'))
    list.push({
      id: `usb:${vendor}:${product}:${serial ? serial.replace(/[^\w.-]/g, '') : 'port-' + port}`,
      name: ids.DES || [make, model].filter(Boolean).join(' ') || 'USB printer',
      make: make || null,
      model: model || null,
      escpos: /ESC\/?POS/i.test(ids.CMD || '') || /epson|star|bixolon|citizen|xprinter|rongta|sewoo/i.test(make || ''),
      path: path.join(sys.devRoot, 'usb', name),
    })
  }
  return list
}

/** Write to a device file without ever blocking a thread: a busy printer answers EAGAIN, so wait and try again. */
async function writeDevice(file, data, { timeoutMs = 10000 } = {}) {
  const { O_WRONLY, O_NONBLOCK = 0, O_APPEND } = fs.constants
  let fh
  try {
    fh = await fs.promises.open(file, O_WRONLY | O_NONBLOCK | O_APPEND)
  } catch (e) {
    throw deviceError(file, e)
  }
  const until = Date.now() + timeoutMs
  try {
    let off = 0
    while (off < data.length) {
      try {
        const { bytesWritten } = await fh.write(data, off, Math.min(8192, data.length - off))
        off += bytesWritten
      } catch (e) {
        if (e.code !== 'EAGAIN' && e.code !== 'EWOULDBLOCK') throw deviceError(file, e)
        if (Date.now() > until) throw new Error(`Printer ${path.basename(file)} didn't take the ticket in ${timeoutMs / 1000}s (out of paper or switched off?)`)
        await sleep(50)
      }
    }
  } finally {
    await fh.close().catch(() => {})
  }
}

function deviceError(file, e) {
  const name = path.basename(file)
  if (e.code === 'ENOENT' || e.code === 'ENODEV' || e.code === 'ENXIO') return new Error(`Printer ${name} isn't plugged in`)
  if (e.code === 'EACCES' || e.code === 'EPERM') return new Error(`The hub isn't allowed to use ${name}: add its user to the lp group (the installer does this)`)
  return new Error(`Printer ${name}: ${e.code || e.message}`)
}

/** Ask a Linux USB printer how it is: DLE EOT 1, 2, 4, then read its answer back. */
async function linuxStatus(file, { timeoutMs = 1500 } = {}) {
  const { O_RDWR, O_NONBLOCK = 0 } = fs.constants
  let fh
  try { fh = await fs.promises.open(file, O_RDWR | O_NONBLOCK) } catch (e) { throw deviceError(file, e) }
  try {
    await fh.write(Buffer.from([0x10, 0x04, 1, 0x10, 0x04, 2, 0x10, 0x04, 4]))
    const replies = []
    const buf = Buffer.alloc(16)
    const until = Date.now() + timeoutMs
    while (replies.length < 3 && Date.now() < until) {
      try {
        const { bytesRead } = await fh.read(buf, 0, buf.length, null)
        if (bytesRead > 0) replies.push(...buf.subarray(0, bytesRead))
        else await sleep(50)
      } catch (e) {
        // A printer that can't answer (no way back on its USB link): no status.
        if (e.code === 'EAGAIN' || e.code === 'EWOULDBLOCK') { await sleep(50); continue }
        return null
      }
    }
    return replies.length >= 3 ? decodeStatus(replies) : null
  } finally {
    await fh.close().catch(() => {})
  }
}

// ── Windows ──────────────────────────────────────────────────────────

/** Run a PowerShell script (passed encoded, so nothing needs quoting); values go in environment variables. */
function powershell(sys, script, env = {}, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from('$ErrorActionPreference = "Stop"\n' + script, 'utf16le').toString('base64')
    const child = sys.spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      env: { ...process.env, ...env }, windowsHide: true,
    })
    let out = ''
    let err = ''
    const t = setTimeout(() => { child.kill(); reject(new Error('Windows didn\'t answer in ' + timeoutMs / 1000 + 's')) }, timeoutMs)
    child.stdout?.on('data', c => { out += c })
    child.stderr?.on('data', c => { err += c })
    child.on('error', e => { clearTimeout(t); reject(e) })
    child.on('close', code => {
      clearTimeout(t)
      if (code === 0) resolve(out.trim())
      else reject(new Error((err.trim().split('\n').find(l => l.trim()) || 'PowerShell failed (' + code + ')').slice(0, 200)))
    })
  })
}

// Printers Windows lists that aren't receipt printers.
const VIRTUAL = /pdf|xps|onenote|fax|send to|journal note|document writer/i

export const PS_LIST = 'Get-Printer | Select-Object Name, DriverName, PortName, PrinterStatus | ConvertTo-Json -Compress'

async function windowsPrinters(sys) {
  const out = await powershell(sys, PS_LIST)
  if (!out) return []
  const rows = [].concat(JSON.parse(out))
  return rows.filter(r => r?.Name && !VIRTUAL.test(r.Name) && !VIRTUAL.test(r.DriverName || '')).map(r => ({
    id: 'win:' + r.Name,
    name: r.Name,
    make: null,
    model: r.DriverName || null,
    escpos: /epson|tm-|star|esc\/?pos|pos-?80|receipt|xprinter|bixolon|citizen/i.test((r.DriverName || '') + ' ' + r.Name),
    path: r.PortName || null,
    win_status: r.PrinterStatus ?? null,
  }))
}

// The RAW print job: winspool's OpenPrinter / StartDocPrinter (datatype RAW) / WritePrinter.
export const PS_PRINT = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class MacaroonieRaw {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern int StartDocPrinter(IntPtr handle, int level, [In] DOCINFO info);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool WritePrinter(IntPtr handle, byte[] bytes, int count, out int written);
  public static void Send(string printer, byte[] bytes) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new System.ComponentModel.Win32Exception();
    try {
      DOCINFO info = new DOCINFO();
      info.pDocName = "Macaroonie ticket";
      info.pDataType = "RAW";
      if (StartDocPrinter(h, 1, info) == 0) throw new System.ComponentModel.Win32Exception();
      try {
        StartPagePrinter(h);
        int written;
        if (!WritePrinter(h, bytes, bytes.Length, out written) || written != bytes.Length) throw new System.ComponentModel.Win32Exception();
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
"@
[MacaroonieRaw]::Send($env:MACAROONIE_PRINTER, [System.IO.File]::ReadAllBytes($env:MACAROONIE_FILE))
`

async function windowsPrint(sys, name, data) {
  const file = path.join(os.tmpdir(), 'macaroonie-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.bin')
  await fs.promises.writeFile(file, data)
  try {
    await powershell(sys, PS_PRINT, { MACAROONIE_PRINTER: name, MACAROONIE_FILE: file })
  } finally {
    await fs.promises.unlink(file).catch(() => {})
  }
}

// MSFT_Printer PrinterStatus: what each number means for a receipt printer.
const WIN_STATUS = {
  0: {}, 9: {}, 10: {}, 11: {}, 14: {}, 15: {}, 16: {}, 17: {}, 25: {},
  1: { offline: 'Paused in Windows' }, 2: { offline: 'Error' }, 4: { offline: 'Paper jam' },
  5: { paperOut: true }, 7: { offline: 'Paper problem' }, 8: { offline: 'Offline' },
  13: { offline: 'Not available' }, 21: { offline: 'Needs attention' }, 23: { coverOpen: true },
}
const WIN_WORDS = { Normal: 0, Paused: 1, Error: 2, PaperJam: 4, PaperOut: 5, PaperProblem: 7, Offline: 8, NotAvailable: 13, UserIntervention: 21, DoorOpen: 23 }

/** A Windows printer's state from Get-Printer's PrinterStatus (a number, or a word on some systems). */
export function windowsStatus(value) {
  const n = typeof value === 'number' ? value : WIN_WORDS[String(value)] ?? 0
  const s = WIN_STATUS[n] || {}
  return { online: !s.offline, paperNearEnd: false, paperOut: !!s.paperOut, coverOpen: !!s.coverOpen, error: s.offline || null }
}

// ── The hub's side ──────────────────────────────────────────────────

/**
 * The printers plugged into this computer:
 * [{ id, name, make, model, escpos, path }]. Never throws (an empty list).
 */
export async function findPrinters(sys = usbSystem()) {
  try {
    if (sys.platform === 'win32') return await windowsPrinters(sys)
    if (sys.platform === 'linux') return linuxPrinters(sys)
  } catch { /* nothing found is the answer */ }
  return []
}

const queues = new Map() // id -> promise of the last job

/** Run `fn` after everything already queued for this printer (a status question never lands inside a ticket). */
function queued(id, fn) {
  const job = (queues.get(id) || Promise.resolve()).catch(() => {}).then(fn)
  queues.set(id, job)
  return job
}

/**
 * Print to a printer plugged into this computer, found by its id. Jobs to the
 * same printer go one after another; a failed one is tried `attempts` times.
 */
export function printLocal({ id, data, sys = usbSystem(), attempts = 2, find = findPrinters }) {
  const run = async () => {
    let last
    for (let i = 0; i < attempts; i++) {
      try {
        const found = (await find(sys)).find(p => p.id === id)
        if (!found) throw new Error('Not plugged into the hub (or switched off)')
        if (sys.platform === 'win32') await windowsPrint(sys, found.name, data)
        else await writeDevice(found.path, data)
        return { attempts: i + 1, name: found.name }
      } catch (e) {
        last = e
        if (i < attempts - 1) await sleep(1000 * (i + 1))
      }
    }
    throw last
  }
  return queued(id, run)
}

/**
 * How a plugged-in printer is: { online, paperNearEnd, paperOut, coverOpen, error },
 * or null when it can't say (still printable). Throws when it isn't there.
 */
export async function localStatus({ id, sys = usbSystem(), found }) {
  const p = (found || await findPrinters(sys)).find(x => x.id === id)
  if (!p) throw new Error('Not plugged into the hub (or switched off)')
  if (sys.platform === 'win32') return windowsStatus(p.win_status)
  return queued(id, () => linuxStatus(p.path))
}
