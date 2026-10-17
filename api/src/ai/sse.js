// src/ai/sse.js
//
// Server-sent events for the chats (POST /api/ai/chat, POST /ai-api/chat
// with Accept: text/event-stream). The stream opens with the first event, so
// anything refused before that (no access, allowance used up, chat busy) is
// still an ordinary JSON error. Once open, events go out as
//
//   event: <type>
//   data: <json>
//
// with a comment line every HEARTBEAT_MS so no proxy in between gives up on
// a quiet moment (a long tool call, the model thinking). X-Accel-Buffering
// keeps nginx from holding the events back on server blocks that buffer.
// The person closing the page doesn't stop the turn: writes after that are
// dropped, and the reply is in the chat when they come back.

import { errorResponse } from '../middleware/error.js'
import { ToolError } from './context.js'

const HEARTBEAT_MS = 15_000

export const wantsStream = req => /\btext\/event-stream\b/.test(String(req.headers.accept || ''))

/** An error once the stream is open: logged like the error handler would,
 *  sent as `event: error` with the same body a JSON reply would have. */
export function errorEvent(req, err) {
  const e = err instanceof ToolError ? Object.assign(new Error(err.message), { statusCode: err.status || 400 }) : err
  const { status, body } = errorResponse(e)
  if (status >= 500) req.log.error({ err }, 'AI chat failed')
  else req.log.warn({ status, error: body.error }, 'AI chat refused')
  return { type: 'error', status, ...body, ...(err.withdrawn ? { withdrawn: true } : {}) }
}

export function eventStream(reply) {
  const raw = reply.raw
  let open = false, gone = false, timer = null
  raw.on('close', () => { gone = true; clearInterval(timer) })
  raw.on('error', () => { gone = true })

  const write = text => {
    if (gone || raw.writableEnded) return
    try { raw.write(text) } catch { gone = true }
  }

  function start() {
    if (open) return
    open = true
    reply.hijack()
    raw.writeHead(200, {
      'Content-Type':      'text/event-stream; charset=utf-8',
      'Cache-Control':     'no-cache, no-transform',
      'Connection':        'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    timer = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS)
    timer.unref?.()
  }

  return {
    get open() { return open },
    send(event) {
      start()
      write('event: ' + event.type + '\ndata: ' + JSON.stringify(event) + '\n\n')
    },
    end() {
      clearInterval(timer)
      if (open && !raw.writableEnded) {
        try { raw.end() } catch { /* gone */ }
      }
    },
  }
}
