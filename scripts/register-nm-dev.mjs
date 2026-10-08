import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { computeExtensionId } from './nm-extension-id.mjs'

const NM_HOST_NAME = 'com.dogear.nmhost'
const BROWSER_KEYS = ['Google\\Chrome', 'Microsoft\\Edge']
const root = fileURLToPath(new URL('..', import.meta.url))
const devDir = `${root}build\\nm-host-dev`

if (process.platform !== 'win32') {
  console.error('register-nm-dev 仅支持 Windows；macOS 请在 Dogear 设置页 → 基础设置 → 浏览器扩展 点击「注册到浏览器」（dev/prod 通用）')
  process.exit(1)
}

function reg(args) {
  return execFileSync('reg', args, { encoding: 'utf8' })
}

if (process.argv.includes('--unregister')) {
  for (const browserKey of BROWSER_KEYS) {
    const keyPath = `HKCU\\Software\\${browserKey}\\NativeMessagingHosts\\${NM_HOST_NAME}`
    try {
      reg(['delete', keyPath, '/f'])
      console.log(`已删除: ${keyPath}`)
    } catch {
      console.log(`不存在（跳过）: ${keyPath}`)
    }
  }
  process.exit(0)
}

const manifest = JSON.parse(readFileSync(`${root}extension\\manifest.json`, 'utf8'))
if (!manifest.key) {
  console.error('extension/manifest.json 缺少 key 字段')
  process.exit(1)
}
const extensionId = computeExtensionId(manifest.key)

mkdirSync(`${root}build\\nm-host-dev`, { recursive: true })

const batContent = [
  '@echo off',
  'cd /d "%~dp0..\\..\\"',
  'set ELECTRON_RUN_AS_NODE=1',
  '"node_modules\\electron\\dist\\electron.exe" resources\\nm-host\\nm-bridge-worker.cjs',
  ''
].join('\r\n')
writeFileSync(`${devDir}\\nm-host-dev.bat`, batContent, 'utf8')

const devManifest = {
  name: NM_HOST_NAME,
  description: 'Dogear 浏览器扩展 Native Messaging 宿主（dev）',
  path: 'nm-host-dev.bat',
  type: 'stdio',
  allowed_origins: [`chrome-extension://${extensionId}/`]
}
const devManifestPath = `${devDir}\\${NM_HOST_NAME}.json`
writeFileSync(devManifestPath, `${JSON.stringify(devManifest, null, 2)}\n`, 'utf8')

for (const browserKey of BROWSER_KEYS) {
  const keyPath = `HKCU\\Software\\${browserKey}\\NativeMessagingHosts\\${NM_HOST_NAME}`
  reg(['add', keyPath, '/ve', '/d', devManifestPath, '/f'])
  console.log(`已注册: ${keyPath} -> ${devManifestPath}`)
}
console.log(`extension id: ${extensionId}`)
