import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ChevronRight, FolderOpen, RefreshCw, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { client } from '@/lib/client';
import { showConfirm } from '@/stores/confirm-store';

interface CustomSkillMeta {
  source: 'builtin' | 'custom';
  name: string;
  description?: string;
}

interface CustomSkillsSectionProps {
  skills: CustomSkillMeta[];
  onRefresh: () => Promise<void>;
  onOpen: (name: string) => void;
}

function SkillRow({
  name,
  description,
  onOpen,
}: {
  name: string;
  description?: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`打开 ${name}`}
      className="flex items-center gap-3 px-3 py-2 text-left w-full transition-colors hover:bg-muted/40"
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium font-mono truncate">{name}</div>
        {description && <div className="text-xs text-muted-foreground truncate">{description}</div>}
      </div>
      <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function baseName(dirPath: string): string {
  const parts = dirPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? dirPath;
}

export function CustomSkillsSection({ skills, onRefresh, onOpen }: CustomSkillsSectionProps) {
  const custom = skills.filter((s) => s.source === 'custom');
  const [skillsDir, setSkillsDir] = useState('');
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    client
      .getCustomSkillsDir()
      .then((r) => {
        if (!cancelled && r.path) setSkillsDir(r.path);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const importSkill = async () => {
    setImporting(true);
    try {
      const picked = await client.pickDirectory();
      if (picked.canceled || !picked.path) return;
      let r = await client.importCustomSkill({ srcDir: picked.path, overwrite: false });
      if (r.conflict) {
        const ok = await showConfirm('覆盖导入', `custom/skills/${baseName(picked.path)} 已存在，将删除旧目录后导入。`);
        if (!ok) return;
        r = await client.importCustomSkill({ srcDir: picked.path, overwrite: true });
      }
      if (r.error) {
        toast.error('导入失败', { description: r.error });
        return;
      }
      toast.success('已导入');
      await onRefresh();
    } catch (error) {
      toast.error('导入失败', { description: String(error) });
    } finally {
      setImporting(false);
    }
  };

  return (
    <section className="space-y-2">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">自定义技能</h3>
          <p className="text-xs text-muted-foreground flex items-center gap-1 min-w-0 mt-0.5">
            <FolderOpen className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate" title={skillsDir}>{skillsDir || '…'}</span>
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            启停在场景页「自定义 Skill」分类，逐个开关。
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button variant="outline" size="sm" disabled={importing} onClick={() => void importSkill()}>
            <Upload className="w-3.5 h-3.5" />
            导入
          </Button>
          <Button variant="outline" size="sm" onClick={() => void onRefresh()}>
            <RefreshCw className="w-3.5 h-3.5" />
            扫描
          </Button>
        </div>
      </div>
      <div className="rounded-md border divide-y overflow-hidden bg-background">
        {custom.map((s) => (
          <SkillRow
            key={s.name}
            name={s.name}
            description={s.description}
            onOpen={() => onOpen(s.name)}
          />
        ))}
        {custom.length === 0 && (
          <div className="px-3 py-3 text-xs text-muted-foreground">
            暂无自定义技能；可导入目录，或手动放置到上述路径后点「扫描」。
          </div>
        )}
      </div>
    </section>
  );
}
