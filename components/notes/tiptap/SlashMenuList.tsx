import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { SlashMenuItem } from './slash-items';

export interface SlashMenuHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface SlashMenuListProps {
  items: SlashMenuItem[];
  command: (item: SlashMenuItem) => void;
}

export const SlashMenuList = forwardRef<SlashMenuHandle, SlashMenuListProps>(
  ({ items, command }, ref) => {
    const [index, setIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => setIndex(0), [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown: (event) => {
        if (event.key === 'ArrowDown') {
          setIndex((i) => (items.length ? (i + 1) % items.length : 0));
          return true;
        }
        if (event.key === 'ArrowUp') {
          setIndex((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          const item = items[index];
          if (!item) return false;
          command(item);
          return true;
        }
        return false;
      },
    }));

    useEffect(() => {
      listRef.current
        ?.querySelector('[data-selected="true"]')
        ?.scrollIntoView({ block: 'nearest' });
    }, [index]);

    return (
      <div ref={listRef} className="notes-slash-menu">
        {items.length === 0 ? (
          <div className="notes-slash-menu-empty">无匹配</div>
        ) : (
          items.map((item, i) => (
            <button
              key={item.id}
              type="button"
              data-selected={i === index}
              onMouseEnter={() => setIndex(i)}
              onClick={() => command(item)}
              title={item.title}
            >
              <item.icon className="w-4 h-4 shrink-0" />
              <span>{item.title}</span>
            </button>
          ))
        )}
      </div>
    );
  },
);

SlashMenuList.displayName = 'SlashMenuList';
