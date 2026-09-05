import { createHash } from 'node:crypto'

export function computeExtensionId(manifestKey) {
  const spkiDer = Buffer.from(manifestKey, 'base64')
  return createHash('sha256')
    .update(spkiDer)
    .digest('hex')
    .slice(0, 32)
    .replace(/./g, (v) => String.fromCharCode(97 + parseInt(v, 16)))
}
