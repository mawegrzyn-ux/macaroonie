// .ico pictures (favicons) for the website and Media uploads. Browsers label
// them image/x-icon or image/vnd.microsoft.icon, and some send no type at
// all, so the file's name and first bytes decide. Stored as image/x-icon.

export const ICON_MIME = 'image/x-icon'
const ICON_MIMES = new Set([ICON_MIME, 'image/vnd.microsoft.icon'])

/** Whether an upload may be an .ico: an icon type, or no useful type and a .ico name. */
export function mayBeIcon(mimetype, filename) {
  if (ICON_MIMES.has(mimetype)) return true
  return (!mimetype || mimetype === 'application/octet-stream') && /\.ico$/i.test(filename || '')
}

/** An ICO file starts 00 00 01 00, then how many pictures it holds (at least one). */
export function isIcon(buf) {
  return buf.length >= 22 && buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0 && buf.readUInt16LE(4) > 0
}

/** The largest picture's size in pixels (a 0 byte means 256). */
export function iconSize(buf) {
  let best = null
  const count = buf.readUInt16LE(4)
  for (let i = 0; i < count && 6 + i * 16 + 16 <= buf.length; i++) {
    const w = buf[6 + i * 16] || 256
    const h = buf[7 + i * 16] || 256
    if (!best || w * h > best.width * best.height) best = { width: w, height: h }
  }
  return best
}
