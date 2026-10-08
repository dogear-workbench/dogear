import fs from 'fs';
import { getGlobalTopicPath, parseFrontmatter } from '../memory/memory-fs.js';

const MAX_READ_BYTES = 8 * 1024;
const PLAYBOOK_SLUG = 'browser-playbook';

export interface BrowserPlaybookReadResult {
  exists: boolean;
  content: string;
}

export function readBrowserPlaybook(): BrowserPlaybookReadResult {
  const file = getGlobalTopicPath(PLAYBOOK_SLUG);
  if (!fs.existsSync(file)) return { exists: false, content: '' };
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const { body } = parseFrontmatter(raw);
    return readTruncated(() => body.replace(/^\n/, ''));
  } catch {
    return { exists: false, content: '' };
  }
}

function readTruncated(read: () => string): BrowserPlaybookReadResult {
  try {
    const raw = read();
    const buf = Buffer.from(raw, 'utf8');
    if (buf.length <= MAX_READ_BYTES) return { exists: true, content: raw };
    const head = buf.subarray(0, MAX_READ_BYTES).toString('utf8').replace(/\uFFFD+$/, '');
    return {
      exists: true,
      content: `${head}\n\n---\n（浏览器调研通用技巧超过 8KB，以上内容已截断，完整内容请查看档案文件）`,
    };
  } catch {
    return { exists: false, content: '' };
  }
}
