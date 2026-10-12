// hub/src/printer.js
//
// Sends ESC/POS bytes to a network printer over raw TCP (port 9100), one job
// at a time per printer, with retries. printerStatus() asks the printer for
// its status (DLE EOT), which Epson TM printers answer on the same connection;
// some clones don't answer, which only means no status, not a failed print.

import net from 'node:net'

const queues = new Map() // "host:port" -> promise of the last job

function send({ host, port = 9100, data, timeoutMs = 5000 }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port })
    let done = false
    const finish = err => {
      if (done) return
      done = true
      socket.destroy()
      err ? reject(err) : resolve()
    }
    socket.setTimeout(timeoutMs, () => finish(new Error(`Printer ${host}:${port} didn't answer in ${timeoutMs / 1000}s`)))
    socket.on('error', e => finish(new Error(`Printer ${host}:${port}: ${e.code || e.message}`)))
    socket.on('connect', () => socket.end(data, () => finish()))
  })
}

/**
 * Print `data` (Buffer). Jobs to the same printer go one after another;
 * a failed job is tried `attempts` times, waiting 1s, 2s, ... between tries.
 */
export function print({ host, port = 9100, data, attempts = 3, timeoutMs = 5000 }) {
  const key = host + ':' + port
  const run = async () => {
    let last
    for (let i = 0; i < attempts; i++) {
      try {
        await send({ host, port, data, timeoutMs })
        return { attempts: i + 1 }
      } catch (e) {
        last = e
        if (i < attempts - 1) await new Promise(r => setTimeout(r, 1000 * (i + 1)))
      }
    }
    throw last
  }
  const job = (queues.get(key) || Promise.resolve()).catch(() => {}).then(run)
  queues.set(key, job)
  return job
}

/**
 * Ask the printer for its status. Resolves to
 * { online, paperNearEnd, paperOut, coverOpen } or null when the printer doesn't answer.
 */
export function printerStatus({ host, port = 9100, timeoutMs = 3000 }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port })
    const replies = []
    let done = false
    const finish = (err, value) => {
      if (done) return
      done = true
      socket.destroy()
      err ? reject(err) : resolve(value)
    }
    socket.setTimeout(timeoutMs, () => finish(null, replies.length ? decode(replies) : null))
    socket.on('error', e => finish(new Error(`Printer ${host}:${port}: ${e.code || e.message}`)))
    socket.on('data', chunk => {
      replies.push(...chunk)
      if (replies.length >= 3) finish(null, decode(replies))
    })
    // DLE EOT 1 (printer), 2 (offline cause), 4 (paper roll sensor)
    socket.on('connect', () => socket.write(Buffer.from([0x10, 0x04, 1, 0x10, 0x04, 2, 0x10, 0x04, 4])))
  })
}

function decode([printer = 0, offline = 0, paper = 0]) {
  return {
    online: !(printer & 0x08),
    coverOpen: !!(offline & 0x04),
    paperNearEnd: (paper & 0x0c) === 0x0c,
    paperOut: (paper & 0x60) === 0x60,
  }
}
