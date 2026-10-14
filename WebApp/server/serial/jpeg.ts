/**
 * Cheap sanity check on bytes a device claims are a JPEG. It starts with the
 * SOI marker (FF D8 FF) and an EOI marker (FF D9) appears near the end. OV2640
 * frames can carry a few padding bytes after EOI, hence the small tail window.
 */
export function isJpeg(buf: Buffer): boolean {
  if (buf.length < 8) return false
  if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return false
  const tailStart = Math.max(2, buf.length - 16)
  for (let i = buf.length - 2; i >= tailStart; i--) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd9) return true
  }
  return false
}
