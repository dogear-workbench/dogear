import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { computeExtensionId } from './nm-extension-id.mjs'

const NM_HOST_NAME = 'com.dogear.nmhost'
const root = fileURLToPath(new URL('..', import.meta.url))

const manifest = JSON.parse(readFileSync(`${root}/extension/manifest.json`, 'utf8'))
if (!manifest.key) {
  console.error('extension/manifest.json 缺少 key 字段')
  process.exit(1)
}
const extensionId = computeExtensionId(manifest.key)

const nmManifest = {
  name: NM_HOST_NAME,
  description: 'Dogear 浏览器扩展 Native Messaging 宿主',
  path: 'nm-host.bat',
  type: 'stdio',
  allowed_origins: [`chrome-extension://${extensionId}/`]
}

const outDir = `${root}/resources/nm-host`
mkdirSync(outDir, { recursive: true })
const outPath = `${outDir}/${NM_HOST_NAME}.json`
writeFileSync(outPath, `${JSON.stringify(nmManifest, null, 2)}\n`, 'utf8')

console.log(`extension id: ${extensionId}`)
console.log(`written: ${outPath}`)
