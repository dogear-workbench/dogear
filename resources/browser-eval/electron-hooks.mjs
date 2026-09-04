import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const stubUrl = pathToFileURL(path.join(here, 'electron-stub.mjs')).href;

export async function resolve(specifier, context, next) {
  if (specifier === 'electron') {
    return { url: stubUrl, format: 'module', shortCircuit: true };
  }
  return next(specifier, context);
}
