import { useMemo } from 'react';
import { listHotkeys } from '@/lib/hotkey-registry';
import type { SettingsSearchEntry } from './search-index';

export const SHORTCUTS_SEARCH_ENTRIES: SettingsSearchEntry[] = [
  { label: '快捷键清单', description: '应用内置快捷键一览，只读，随对应组件挂载生效' },
];

export function ShortcutsTab() {
  const groups = useMemo(() => {
    const entries = listHotkeys();
    const scopes: string[] = [];
    const byScope = new Map<string, typeof entries>();
    for (const entry of entries) {
      let list = byScope.get(entry.scope);
      if (!list) {
        list = [];
        byScope.set(entry.scope, list);
        scopes.push(entry.scope);
      }
      list.push(entry);
    }
    return scopes.map((scope) => ({ scope, entries: byScope.get(scope)! }));
  }, []);

  return (
    <div className="max-w-2xl mx-auto py-6 px-6">
      <h2 className="text-lg font-semibold mb-1">快捷键</h2>
      <p className="text-sm text-muted-foreground mb-6">
        应用内置快捷键清单，只读；快捷键随对应组件挂载生效
      </p>
      <div className="space-y-6">
        {groups.map(({ scope, entries }) => (
          <div key={scope} className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">{scope}</h3>
            <div className="rounded-lg border divide-y divide-border">
              {entries.map((entry) => (
                <div key={entry.id} className="flex items-center gap-3 px-4 py-2.5">
                  <kbd className="inline-flex items-center h-6 px-2 rounded border bg-muted text-xs font-mono shrink-0">
                    {entry.combo}
                  </kbd>
                  <span className="text-sm flex-1 min-w-0">{entry.description}</span>
                  <span className="text-xs text-muted-foreground font-mono shrink-0">{entry.id}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
