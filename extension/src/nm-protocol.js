const HEADER_SIZE = 4
const MAX_FRAME_BYTES = 64 * 1024 * 1024

export function encodeFrame(message) {
  const payload = new TextEncoder().encode(JSON.stringify(message))
  const frame = new Uint8Array(HEADER_SIZE + payload.length)
  new DataView(frame.buffer).setUint32(0, payload.length, true)
  frame.set(payload, HEADER_SIZE)
  return frame
}

export function makeDecoder() {
  let buffer = new Uint8Array(0)
  let frameHandler = null

  const emit = (message) => {
    if (frameHandler) frameHandler(message)
  }

  const consume = () => {
    while (buffer.length >= HEADER_SIZE) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      const length = view.getUint32(0, true)
      if (buffer.length < HEADER_SIZE + length) return
      if (length > MAX_FRAME_BYTES) {
        buffer = new Uint8Array(0)
        emit({ type: 'protocol_error', error: 'frame too large' })
        return
      }
      const payload = buffer.subarray(HEADER_SIZE, HEADER_SIZE + length)
      buffer = buffer.subarray(HEADER_SIZE + length)
      let message
      try {
        message = JSON.parse(new TextDecoder().decode(payload))
      } catch {
        emit({ type: 'protocol_error', error: 'invalid json frame' })
        continue
      }
      emit(message)
    }
  }

  return {
    onFrame(handler) {
      frameHandler = handler
    },
    push(chunk) {
      const merged = new Uint8Array(buffer.length + chunk.length)
      merged.set(buffer)
      merged.set(chunk, buffer.length)
      buffer = merged
      consume()
    }
  }
}
