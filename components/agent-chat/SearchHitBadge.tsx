export function SearchHitBadge({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300 flex-shrink-0">
      命中 {count} 处
    </span>
  );
}
