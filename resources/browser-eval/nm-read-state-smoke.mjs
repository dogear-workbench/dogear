import { pathToFileURL, fileURLToPath } from 'node:url'
import path from 'node:path'

const here = fileURLToPath(new URL('.', import.meta.url))
const projectRoot = path.resolve(here, '..', '..')
const extProtocolUrl = pathToFileURL(path.join(projectRoot, 'extension', 'src', 'nm-protocol.js')).href
const domActionsUrl = pathToFileURL(path.join(projectRoot, 'extension', 'src', 'dom-actions.js')).href

const { encodeFrame, makeDecoder } = await import(extProtocolUrl)
const { readStateFn } = await import(domActionsUrl)

let failures = 0
function check(name, cond, extra = '') {
  if (cond) {
    console.log(`PASS ${name}`)
  } else {
    failures += 1
    console.error(`FAIL ${name}${extra ? `（${extra}）` : ''}`)
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

const command = {
  type: 'command',
  requestId: 'req-1',
  tabId: 7,
  url: 'https://www.xiaohongshu.com/search_result?keyword=咖啡',
  kind: 'read_state',
  params: { path: 'home.feed.0' }
}
const gotCommand = decodeOne(encodeFrame(command))
check(
  'read_state command kind/path roundtrip',
  gotCommand !== null &&
    gotCommand.type === 'command' &&
    gotCommand.kind === 'read_state' &&
    gotCommand.params.path === 'home.feed.0'
)

const result = {
  type: 'command_result',
  requestId: 'req-1',
  ok: true,
  data: { json: '{"id":"note-1"}', truncated: false, totalLength: 14 }
}
const gotResult = decodeOne(encodeFrame(result))
check(
  'read_state command_result data roundtrip',
  gotResult !== null && gotResult.ok === true && gotResult.data.json === result.data.json
)

globalThis.window = {}
const missing = readStateFn(null)
check('missing → {missing:true}', missing !== null && typeof missing === 'object' && missing.missing === true)

const circular = {}
circular.self = circular
globalThis.window = {
  __INITIAL_STATE__: {
    home: { feed: [{ id: 'note-1', title: '第一篇' }, { id: 'note-2', title: '第二篇' }], total: 2 },
    user: { name: '测试用户', level: 3 },
    keyword: '咖啡',
    empty: {},
    bad: circular
  }
}

const summary = readStateFn(null)
check('顶层概要：各 key 类型/长度标注', (() => {
  const lines = String(summary.summary).split('\n')
  const has = (s) => lines.some((l) => l.includes(s))
  return (
    has('home：object，子项 2') &&
    has('user：object，子项 2') &&
    has('keyword：string，长度 2') &&
    has('empty：object，子项 0') &&
    has('home.feed') === false
  )
})(), summary.summary)

const drill = readStateFn('home.feed.0')
check(
  'path 下钻：纯数字段取数组下标',
  drill.json === '{"id":"note-1","title":"第一篇"}' && drill.truncated === false && drill.totalLength === drill.json.length,
  JSON.stringify(drill)
)

const deep = readStateFn('home.feed.1.id')
check('path 深下钻：数组下标后继续取字段', deep.json === '"note-2"' && deep.truncated === false)

const primitive = readStateFn('keyword')
check('path 命中原始值：JSON 字符串带引号', primitive.json === '"咖啡"')

const emptyHit = readStateFn('empty')
check('path 命中空对象：返回 {}', emptyHit.json === '{}' && emptyHit.truncated === false)

const notFound = readStateFn('home.feed.9')
check(
  'path 越界：notFound + 该层可用 key',
  notFound.notFound === true && JSON.stringify(notFound.availableKeys) === '["0","1"]',
  JSON.stringify(notFound)
)

const notObject = readStateFn('user.name.x')
check(
  '下钻穿过原始值：notFound + availableKeys 空',
  notObject.notFound === true && Array.isArray(notObject.availableKeys) && notObject.availableKeys.length === 0
)

const unknownTop = readStateFn('nope.deep')
check(
  '首段不存在：notFound + 顶层可用 key',
  unknownTop.notFound === true && unknownTop.availableKeys.includes('home') && unknownTop.availableKeys.includes('bad'),
  JSON.stringify(unknownTop.availableKeys)
)

const broken = readStateFn('bad')
check('循环引用：notSerializable 不抛异常', broken.notSerializable === true && broken.json === undefined)

globalThis.window = { __INITIAL_STATE__: { big: 'x'.repeat(9000) } }
const longHit = readStateFn('big')
check(
  '超长子树截断 8000 + 标记',
  longHit.truncated === true &&
    longHit.totalLength === 9002 &&
    longHit.json.length === 8005 &&
    longHit.json.endsWith('…（截断）') &&
    longHit.json.slice(0, 8000).replaceAll('x', '').replaceAll('"', '') === ''
)

globalThis.window = { __INITIAL_STATE__: {} }
const emptySummary = readStateFn(null)
check('空对象 state：非 missing，返回空 summary', emptySummary.missing !== true && emptySummary.summary === '', JSON.stringify(emptySummary))

process.exit(failures ? 1 : 0)
