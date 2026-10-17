// A stand-in for the Claude API: answers POST /v1/messages from a script of
// replies, as a stream of server-sent events when the request asks for one
// (the same event shapes the API sends), else as JSON. Start it before the
// app is imported: it sets ANTHROPIC_BASE_URL and ANTHROPIC_API_KEY.
//
//   const claude = await startFakeClaude()
//   claude.script.push(req => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hi' }] }))
//   claude.script.push(() => ({ status: 529, type: 'overloaded_error' }))   // an error reply
//   claude.requests  // [{ headers, body }]
import http from 'node:http'

function pieces(text, size) {
  const out = []
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size))
  return out.length ? out : ['']
}

export function streamEvents(msg) {
  const u = msg.usage || {}
  const usage = { input_tokens: u.input_tokens || 0, cache_read_input_tokens: u.cache_read_input_tokens || 0, cache_creation_input_tokens: u.cache_creation_input_tokens || 0 }
  const ev = [{ type: 'message_start', message: { ...msg, content: [], stop_reason: null, stop_sequence: null, usage: { ...usage, output_tokens: 1 } } }]
  ;(msg.content || []).forEach((b, index) => {
    if (b.type === 'text') {
      ev.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } })
      for (const t of pieces(b.text, 7)) ev.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: t } })
    } else if (b.type === 'tool_use' || b.type === 'server_tool_use') {
      ev.push({ type: 'content_block_start', index, content_block: { ...b, input: {} } })
      for (const t of pieces(JSON.stringify(b.input ?? {}), 40)) ev.push({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: t } })
    } else if (b.type === 'thinking') {
      ev.push({ type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } })
      ev.push({ type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: b.signature || 'sig' } })
    } else {
      ev.push({ type: 'content_block_start', index, content_block: b })
    }
    ev.push({ type: 'content_block_stop', index })
  })
  ev.push({ type: 'message_delta', delta: { stop_reason: msg.stop_reason, stop_sequence: null }, usage: { ...usage, output_tokens: u.output_tokens || 0 } })
  ev.push({ type: 'message_stop' })
  return ev
}

export async function startFakeClaude() {
  const requests = []
  const script = []
  let n = 0
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', c => { raw += c })
    req.on('end', () => {
      const body = JSON.parse(raw || '{}')
      requests.push({ headers: req.headers, body })
      const next = script.shift()
      const out = next ? next(body) : { status: 500, type: 'api_error', message: 'script ran out' }
      if (out.status) {
        res.writeHead(out.status, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ type: 'error', error: { type: out.type || 'invalid_request_error', message: out.message || 'refused' } }))
      }
      const msg = {
        id: 'msg_fake_' + (++n), type: 'message', role: 'assistant', model: body.model, stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...(out.usage || {}) },
        stop_reason: out.stop_reason, content: out.content || [],
      }
      if (!body.stream) {
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end(JSON.stringify(msg))
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      for (const e of streamEvents(msg)) res.write('event: ' + e.type + '\ndata: ' + JSON.stringify(e) + '\n\n')
      res.end()
    })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:' + server.address().port
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
  return { requests, script, close: () => new Promise(r => server.close(r)) }
}
