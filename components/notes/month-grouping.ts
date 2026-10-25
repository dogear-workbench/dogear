export interface MonthGroup<T> {
  key: string;
  label: string;
  items: T[];
}

export function monthKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function currentMonthKey(): string {
  return monthKey(new Date().toISOString());
}

export function groupByMonth<T>(items: T[], getUpdatedAt: (item: T) => string): Array<MonthGroup<T>> {
  const map = new Map<string, MonthGroup<T>>();
  for (const item of items) {
    const key = monthKey(getUpdatedAt(item));
    let group = map.get(key);
    if (!group) {
      const [year, month] = key.split('-');
      group = { key, label: `${year} 年 ${Number(month)} 月`, items: [] };
      map.set(key, group);
    }
    group.items.push(item);
  }
  const groups = [...map.values()];
  for (const group of groups) {
    group.items.sort((a, b) => getUpdatedAt(b).localeCompare(getUpdatedAt(a)));
  }
  groups.sort((a, b) => b.key.localeCompare(a.key));
  return groups;
}
