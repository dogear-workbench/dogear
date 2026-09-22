import fs from 'fs';
import path from 'path';
import { getConfigDir } from '../settings-service.js';
import { getGlobalTopicPath, parseFrontmatter } from '../memory/memory-fs.js';
import { upsertTopic } from '../memory/memory-service.js';

const MAX_READ_BYTES = 8 * 1024;
const PLAYBOOK_SLUG = 'browser-playbook';
const MIGRATION_KEYWORDS = ['浏览器', '踩坑', '调研', '反爬', 'SERP', '登录墙', '风控'];

export interface BrowserPlaybookReadResult {
  exists: boolean;
  content: string;
}

const DEFAULT_PLAYBOOK = `> 本文件沉淀跨站点适用的浏览器调研通用技巧，由主会话与人工审核维护，子会话只读；会话创建时注入系统提示，改动对新会话生效。

- 对比类配置表的图标型单元格纯文本有损，优先找单版本/单项详情页逐项核对
- 数据页数字 JS 后渲染不可靠时，换官方口径文章或搜索佐证，不要在原页死磕
- 站内搜索表单被 guard_submit 拦截时，改用「关键词 site:域名」通用搜索绕过
- 搜索引擎结果页被反爬只剩分页框架时，直接导航目标站
- SERP 标题足够佐证事实时不必点开全文，省步骤
`;

function playbookFile(): string {
  return path.join(getConfigDir(), 'browser-playbook.md');
}

export function ensureDefaultPlaybook(): void {
  const file = playbookFile();
  if (fs.existsSync(file)) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, DEFAULT_PLAYBOOK, 'utf8');
  } catch {
    // 预置失败不阻塞会话启动，注入方按 exists=false 跳过
  }
}

export function readBrowserPlaybook(): BrowserPlaybookReadResult {
  const fromTopic = readGlobalPlaybookTopic();
  if (fromTopic) return fromTopic;

  ensureDefaultPlaybook();
  const file = playbookFile();
  if (!fs.existsSync(file)) return { exists: false, content: '' };
  return readTruncated(() => fs.readFileSync(file, 'utf8'));
}

function readGlobalPlaybookTopic(): BrowserPlaybookReadResult | null {
  const file = getGlobalTopicPath(PLAYBOOK_SLUG);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const { body } = parseFrontmatter(raw);
    return readTruncated(() => body.replace(/^\n/, ''));
  } catch {
    return null;
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

/**
 * 一次性幂等迁移：全局 browser-playbook.md → 全局记忆主题（slug=browser-playbook）。
 * 主题已存在或旧文件不存在则跳过；主题写入成功后旧文件改名为 .migrated 保留人工确认。
 * 任一步失败只记日志，readBrowserPlaybook 的回退路径仍可用。
 */
export async function migrateBrowserPlaybookIntoMemory(): Promise<void> {
  const legacyFile = playbookFile();
  const topicFile = getGlobalTopicPath(PLAYBOOK_SLUG);
  // 仅在迁移确实要发生时才预置默认旧文件，避免迁移完成后每次启动重新生成残留
  if (!fs.existsSync(topicFile)) {
    ensureDefaultPlaybook();
  }
  if (!fs.existsSync(legacyFile) || fs.existsSync(topicFile)) return;

  try {
    const content = fs.readFileSync(legacyFile, 'utf8');
    await upsertTopic(
      '',
      {
        slug: PLAYBOOK_SLUG,
        title: '浏览器调研通用技巧',
        keywords: MIGRATION_KEYWORDS,
        content,
      },
      'global'
    );
  } catch (err) {
    console.warn('[browser-playbook] 迁移到全局记忆主题失败，继续使用旧文件:', err);
    return;
  }

  try {
    await fs.promises.rename(legacyFile, `${legacyFile}.migrated`);
    console.log('[browser-playbook] 已迁移至全局记忆主题 browser-playbook，旧文件保留为 .migrated');
  } catch (err) {
    console.warn('[browser-playbook] 主题已写入但旧文件改名失败:', err);
  }
}
