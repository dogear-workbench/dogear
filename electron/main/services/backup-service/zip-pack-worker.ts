import { parentPort } from 'worker_threads';
import { packEntriesSync, type PackEntry } from './zip-pack-core.js';

const port = parentPort;
if (!port) throw new Error('zip-pack-worker 仅限 worker_threads 环境');

interface PackRequest {
  entries: PackEntry[];
  outZipPath: string;
}

port.once('message', (req: PackRequest) => {
  try {
    const count = packEntriesSync(req.entries, req.outZipPath);
    port.postMessage({ ok: true, count });
  } catch (err) {
    port.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
