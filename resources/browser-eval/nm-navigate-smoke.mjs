import { pathToFileURL, fileURLToPath } from 'node:url'
import path from 'node:path'

const here = fileURLToPath(new URL('.', import.meta.url))
const projectRoot = path.resolve(here, '..', '..')
const extProtocolUrl = pathToFileURL(path.join(projectRoot, 'extension', 'src', 'nm-protocol.js')).href
const gatewayUrl = pathToFileURL(
  path.join(projectRoot, 'dist', 'main', 'services', 'browser', 'browser-gateway.js')
).href

const { encodeFrame, makeDecoder } = await import(extProtocolUrl)
const { validateNavigateTarget } = await import(gatewayUrl)

let failures = 0
function check(name, cond) {
  if (cond) {
    console.log(`PASS ${name}`)
  } else {
    failures += 1
    console.error(`FAIL ${name}`)
  }
}

function decodeOne(frame) {
  let decoded = null
  const decoder = makeDecoder()
  decoder.onFrame((m) => {
    decoded = m
  })
  decoder.push(frame)
  return decoded
}

const snapshot = {
  type: 'tab_snapshot',
  tabId: 7,
  title: '调研页',
  url: 'https://www.xiaohongshu.com/explore',
  textPreview: '正文预览',
  generation: 3
}
const gotSnapshot = decodeOne(encodeFrame(snapshot))
check(
  'tab_snapshot generation roundtrip',
  gotSnapshot !== null &&
    gotSnapshot.type === 'tab_snapshot' &&
    gotSnapshot.generation === 3 &&
    gotSnapshot.url === snapshot.url
)

const command = {
  type: 'command',
  requestId: 'req-1',
  tabId: 7,
  url: 'https://www.xiaohongshu.com/explore',
  kind: 'navigate',
  params: { targetUrl: 'https://www.xiaohongshu.com/user/abc' }
}
const gotCommand = decodeOne(encodeFrame(command))
check(
  'navigate command targetUrl roundtrip',
  gotCommand !== null &&
    gotCommand.type === 'command' &&
    gotCommand.kind === 'navigate' &&
    gotCommand.params.targetUrl === 'https://www.xiaohongshu.com/user/abc'
)

const result = {
  type: 'command_result',
  requestId: 'req-1',
  ok: true,
  data: { url: 'https://www.xiaohongshu.com/user/abc' }
}
const gotResult = decodeOne(encodeFrame(result))
check(
  'navigate command_result data.url roundtrip',
  gotResult !== null && gotResult.ok === true && gotResult.data.url === result.data.url
)

const origins = ['https://www.xiaohongshu.com']

const blockedOrigin = validateNavigateTarget('https://weibo.com/hot', origins)
check(
  'unauthorized origin blocked',
  blockedOrigin !== null && blockedOrigin.errorCode === 'navigation_blocked'
)

for (const bad of ['javascript:alert(1)', 'file:///C:/x.txt', 'chrome://settings', 'data:text/html,x']) {
  const r = validateNavigateTarget(bad, origins)
  check(`non-http scheme rejected: ${bad}`, r !== null && r.errorCode === 'navigation_blocked')
}

check(
  'invalid url string rejected',
  validateNavigateTarget('not a url', origins)?.errorCode === 'navigation_blocked'
)
check('empty targetUrl rejected', validateNavigateTarget('', origins)?.errorCode === 'navigation_blocked')
check(
  'non-string targetUrl rejected',
  validateNavigateTarget(123, origins)?.errorCode === 'navigation_blocked'
)
check(
  'missing targetUrl rejected',
  validateNavigateTarget(undefined, origins)?.errorCode === 'navigation_blocked'
)

check(
  'authorized origin passes',
  validateNavigateTarget('https://www.xiaohongshu.com/explore', origins) === null
)
check('all_urls wildcard passes', validateNavigateTarget('https://weibo.com/hot', ['<all_urls>']) === null)
check(
  'scheme-host mismatch blocked',
  validateNavigateTarget('http://www.xiaohongshu.com/explore', origins)?.errorCode === 'navigation_blocked'
)

process.exit(failures ? 1 : 0)
