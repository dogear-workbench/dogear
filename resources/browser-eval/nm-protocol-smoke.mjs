import { encodeFrame, makeDecoder } from '../../extension/src/nm-protocol.js'

let failures = 0
function check(name, cond) {
  if (cond) {
    console.log(`PASS ${name}`)
  } else {
    failures += 1
    console.error(`FAIL ${name}`)
  }
}

const hello = { type: 'hello', extensionVersion: '0.1.100', tabId: 42 }
const frame = encodeFrame(hello)
const payloadText = JSON.stringify(hello)
check('header LE uint32', frame[0] === payloadText.length && frame[1] === 0 && frame[2] === 0 && frame[3] === 0)
check('payload bytes', new TextDecoder().decode(frame.subarray(4)) === payloadText)

const chunked = []
const decoder = makeDecoder()
decoder.onFrame((m) => chunked.push(m))
decoder.push(frame.subarray(0, 3))
decoder.push(frame.subarray(3, 10))
decoder.push(frame.subarray(10))
check('chunked decode', chunked.length === 1 && chunked[0].type === 'hello' && chunked[0].tabId === 42)

const coalesced = []
const decoder2 = makeDecoder()
decoder2.onFrame((m) => coalesced.push(m))
const snapshot = {
  type: 'tab_snapshot',
  tabId: 1,
  title: 't'.repeat(100000),
  url: 'https://example.com/page',
  textPreview: 'x'.repeat(500)
}
const f1 = encodeFrame(snapshot)
const f2 = encodeFrame({ type: 'welcome', appVersion: '0.1.100' })
decoder2.push(new Uint8Array(0))
decoder2.push(new Uint8Array([...f1, ...f2]))
check('coalesced multi-frame + large payload', coalesced.length === 2 && coalesced[0].textPreview.length === 500 && coalesced[1].type === 'welcome')

const withError = []
const decoder3 = makeDecoder()
decoder3.onFrame((m) => withError.push(m))
const bad = new Uint8Array(4 + 5)
new DataView(bad.buffer).setUint32(0, 5, true)
bad.set(new TextEncoder().encode('notjs'), 4)
decoder3.push(bad)
decoder3.push(encodeFrame({ type: 'goodbye' }))
check('bad frame yields protocol_error, stream survives', withError.length === 2 && withError[0].type === 'protocol_error' && withError[1].type === 'goodbye')

const ordered = []
const decoder4 = makeDecoder()
decoder4.onFrame((m) => ordered.push(m))
for (let i = 0; i < 200; i += 1) {
  const f = encodeFrame({ seq: i })
  decoder4.push(f.subarray(0, 2))
  decoder4.push(f.subarray(2))
}
check('200 frames split-byte roundtrip order', ordered.length === 200 && ordered.every((m, i) => m.seq === i))

process.exit(failures ? 1 : 0)
