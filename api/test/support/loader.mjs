// Every import of src/middleware/auth.js gets auth-stub.mjs instead. The
// stub imports the real file as auth.js?real, which this leaves alone.
const STUB = new URL('./auth-stub.mjs', import.meta.url).href

export async function resolve(specifier, context, next) {
  const r = await next(specifier, context)
  if (r.url.endsWith('/src/middleware/auth.js')) return { ...r, url: STUB, shortCircuit: true }
  return r
}
