import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatContextLabel, lookupContextWindow } from '@/lib/pi-model-catalog';

export interface UpstreamModel {
  id: string;
  label?: string;
}

interface FetchModelsDialogProps {
  open: boolean;
  profileName: string;
  models: UpstreamModel[];
  existingIds: Set<string>;
  onClose: () => void;
  onConfirm: (selected: UpstreamModel[]) => void;
}

export function FetchModelsDialog({ open, profileName, models, existingIds, onClose, onConfirm }: FetchModelsDialogProps) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (open) setChecked({});
  }, [open]);

  const existingCount = useMemo(() => models.filter(m => existingIds.has(m.id)).length, [models, existingIds]);
  const selected = useMemo(() => models.filter(m => !existingIds.has(m.id) && checked[m.id]), [models, existingIds, checked]);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>从上游拉取模型 — {profileName}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          上游共返回 {models.length} 个模型，其中 {existingCount} 个已在清单。勾选要启用的加入清单（与手填一致，加入后仍可编辑显示名与上下文窗口）。
        </p>
        <div className="max-h-80 rounded-lg border overflow-y-auto">
          <div className="p-2 space-y-0.5">
            {models.map((m) => {
              const exists = existingIds.has(m.id);
              const window = lookupContextWindow(m.id);
              return (
                <label
                  key={m.id}
                  className={`flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm ${exists ? 'opacity-50' : 'hover:bg-muted/50 cursor-pointer'}`}
                >
                  <Checkbox
                    checked={!exists && !!checked[m.id]}
                    disabled={exists}
                    onCheckedChange={(v) => setChecked(prev => ({ ...prev, [m.id]: v === true }))}
                  />
                  <span className="font-mono text-[0.85em]">{m.id}</span>
                  {m.label && m.label !== m.id && <span className="text-xs text-muted-foreground truncate">{m.label}</span>}
                  {exists ? (
                    <Badge variant="secondary" className="ml-auto shrink-0 text-[10px]">已在清单</Badge>
                  ) : (
                    <Badge variant="outline" className="ml-auto shrink-0 text-[10px] tabular-nums">
                      {window ? formatContextLabel(window) : '未识别'}
                    </Badge>
                  )}
                </label>
              );
            })}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={selected.length === 0} onClick={() => onConfirm(selected)}>
            添加所选（{selected.length}）
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
