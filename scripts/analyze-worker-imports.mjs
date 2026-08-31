import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'dist/main';
const ENTRY = path.join(ROOT, 'agents/agent-worker.js');

const fileCache = new Map();

function resolveSpec(spec, fromFile) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [base, base + '.js', path.join(base, 'index.js')];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

function importsOf(file) {
  if (fileCache.has(file)) return fileCache.get(file);
  let src = '';
  try { src = fs.readFileSync(file, 'utf-8'); } catch { return []; }
  const out = [];
  const patterns = [
    /import\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g,
    /export\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src))) out.push(m[1]);
  }
  fileCache.set(file, out);
  return out;
}

function namedElectronImports(file) {
  let src = '';
  try { src = fs.readFileSync(file, 'utf-8'); } catch { return []; }
  const out = [];
  const re = /import\s+\{([^}]*)\}\s+from\s+['"]electron['"]/g;
  let m;
  while ((m = re.exec(src))) out.push(...m[1].split(',').map((s) => s.trim()).filter(Boolean));
  return out;
}

const seen = new Set();
const queue = [ENTRY];
const rbFiles = [];
const electronNamed = [];

while (queue.length) {
  const file = queue.pop();
  if (seen.has(file)) continue;
  seen.add(file);
  for (const spec of importsOf(file)) {
    const resolved = resolveSpec(spec, file);
    if (resolved) queue.push(resolved);
  }
  if (importsOf(file).includes('../renderer-broadcast.js') || importsOf(file).includes('./renderer-broadcast.js')) {
    rbFiles.push(path.relative(ROOT, file));
  }
  const named = namedElectronImports(file);
  if (named.length) electronNamed.push([path.relative(ROOT, file), named.join(',')]);
}

console.log('worker 可达模块总数:', seen.size);
console.log('\n== 静态 import renderer-broadcast 的可达文件 ==');
rbFiles.forEach((f) => console.log(' -', f));
console.log('\n== 具名 import electron 的可达文件 ==');
electronNamed.forEach(([f, n]) => console.log(' -', f, ':', n));
