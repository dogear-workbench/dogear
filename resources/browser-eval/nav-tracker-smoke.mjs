import { pathToFileURL, fileURLToPath } from 'node:url'
import path from 'node:path'

const here = fileURLToPath(new URL('.', import.meta.url))
const projectRoot = path.resolve(here, '..', '..')
const trackerUrl = pathToFileURL(path.join(projectRoot, 'extension', 'src', 'nav-tracker.js')).href
const tracker = await import(trackerUrl)

let failures = 0
function check(name, cond) {
  if (cond) {
    console.log(`PASS ${name}`)
  } else {
    failures += 1
    console.error(`FAIL ${name}`)
  }
}

tracker.resetGeneration(1, 'http://a/main')
check('reset sets generation 0', tracker.currentGeneration(1) === 0)

check('bump increments to 1', tracker.bumpGeneration(1, 'http://a/second') === 1)
check('same url does not bump again', tracker.bumpGeneration(1, 'http://a/second') === 1)
check('new url bumps to 2', tracker.bumpGeneration(1, 'http://a/third') === 2)
check('empty url still bumps', tracker.bumpGeneration(1, '') === 3)

check('unknown tab generation is 0', tracker.currentGeneration(99) === 0)
check('bump on unknown tab starts at 1', tracker.bumpGeneration(99, 'http://x/') === 1)

check('ref with generation parses', tracker.parseRefGeneration('e3@7') === 7)
check('ref without generation parses as 0', tracker.parseRefGeneration('e3') === 0)
check('ref e1@0 parses as 0', tracker.parseRefGeneration('e1@0') === 0)
check('invalid ref returns null', tracker.parseRefGeneration('abc') === null)
check('empty ref returns null', tracker.parseRefGeneration('') === null)
check('ref with trailing junk returns null', tracker.parseRefGeneration('e3@1x') === null)
check('non-string ref returns null', tracker.parseRefGeneration(42) === null)

check('click refs match parse', tracker.parseRefGeneration('e12@340') === 340)

process.exit(failures ? 1 : 0)
