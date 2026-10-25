import { useEffect, useState } from 'react';
import { FlaskConical, Globe, FileCode2 } from 'lucide-react';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import { useMarkdownPreviewStore } from '@/stores/markdown-preview-store';
import { formatDateTimeShort } from './history-utils';

interface PlatformScriptEntry {
  name: string;
  fileName: string;
  size: number;
  updatedAt: number;
}

interface SiteKnowledgeEntry {
  domain: string;
  updatedAt: number;
  size: number;
  verifiedCount: number;
  discoveryCount: number;
}

const isDataCenterWindow = () => window.location.hash.startsWith('#/data-center');

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function LearnedAssetsSection() {
  const openInline = useMarkdownPreviewStore((s) => s.openInline);
  const [scripts, setScripts] = useState<PlatformScriptEntry[] | null>(null);
  const [entries, setEntries] = useState<SiteKnowledgeEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    client.listPlatformScripts().then((r) => {
      if (cancelled) return;
      const list = 'scripts' in r ? r.scripts : undefined;
      if (list) setScripts(list);
    });
    client.listSiteKnowledge().then((r) => {
      if (cancelled) return;
      const list = 'entries' in r ? r.entries : undefined;
      if (list) setEntries(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const openPreview = (fileName: string, content: string) => {
    if (isDataCenterWindow()) {
      toast.info('预览内容已在主窗口的阅读面板打开');
    }
    openInline(fileName, content);
  };

  const openScript = async (name: string, fileName: string) => {
    const r = await client.getPlatformScript({ name });
    if ('error' in r) {
      toast.error(r.error);
      return;
    }
    openPreview(fileName, r.content);
  };

  const openKnowledge = async (domain: string) => {
    const r = await client.getSiteKnowledge({ domain });
    if ('error' in r) {
      toast.error(r.error);
      return;
    }
    if (!r.exists) {
      toast.error('档案不存在');
      return;
    }
    openPreview(`${domain}.md`, r.content);
  };

  return (
    <section className="space-y-3 border-t pt-4">
      <div className="space-y-0.5">
        <h3 className="text-sm font-medium flex items-center gap-1.5">
          <FlaskConical className="w-4 h-4" />
          习得资产
        </h3>
        <p className="text-xs text-muted-foreground">
          Agent 解析文章与浏览站点沉淀的全局资产，已纳入版本备份。点击条目在阅读面板预览。
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <FileCode2 className="w-3.5 h-3.5" />
            平台脚本（文章解析管线）
          </p>
          {scripts === null ? (
            <p className="text-xs text-muted-foreground py-2">加载中...</p>
          ) : scripts.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">暂无平台脚本</p>
          ) : (
            scripts.map((s) => (
              <div
                key={s.name}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-md cursor-pointer text-sm hover:bg-muted/50"
                onClick={() => void openScript(s.name, s.fileName)}
              >
                <span className="font-mono truncate">{s.fileName}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {formatSize(s.size)} · {formatDateTimeShort(s.updatedAt)}
                </span>
              </div>
            ))
          )}
        </div>

        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <Globe className="w-3.5 h-3.5" />
            站点档案（浏览器探索沉淀）
          </p>
          {entries === null ? (
            <p className="text-xs text-muted-foreground py-2">加载中...</p>
          ) : entries.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">暂无站点档案</p>
          ) : (
            entries.map((e) => (
              <div
                key={e.domain}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-md cursor-pointer text-sm hover:bg-muted/50"
                onClick={() => void openKnowledge(e.domain)}
              >
                <span className="font-mono truncate">{e.domain}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  正式 {e.verifiedCount} · 探索 {e.discoveryCount} · {formatDateTimeShort(e.updatedAt)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
