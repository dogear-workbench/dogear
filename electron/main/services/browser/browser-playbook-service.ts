import fs from 'fs';
import path from 'path';
import { getConfigDir } from '../settings-service.js';

const MAX_READ_BYTES = 8 * 1024;

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
  ensureDefaultPlaybook();
  const file = playbookFile();
  if (!fs.existsSync(file)) return { exists: false, content: '' };
  try {
    const raw = fs.readFileSync(file, 'utf8');
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
