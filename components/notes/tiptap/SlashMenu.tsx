import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { exitSuggestion, type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion';
import { createRoot, type Root } from 'react-dom/client';
import { SlashMenuList, type SlashMenuHandle } from './SlashMenuList';
import { filterSlashItems, type SlashMenuItem } from './slash-items';

const SLASH_KEY = new PluginKey('slashMenu');

export const SlashMenu = Extension.create({
  name: 'slashMenu',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      Suggestion<SlashMenuItem>({
        editor,
        pluginKey: SLASH_KEY,
        char: '/',
        items: ({ query }) => filterSlashItems(query),
        command: ({ editor, range, props }) => props.command({ editor, range }),
        render: () => {
          let root: Root | null = null;
          let popup: HTMLDivElement | null = null;
          let handle: SlashMenuHandle | null = null;
          let dismissed = false;
          let getRect: (() => DOMRect | null) | null | undefined = null;

          const position = () => {
            if (!popup || !getRect) return;
            const rect = getRect();
            if (!rect) return;
            popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - popup.offsetWidth - 12))}px`;
            popup.style.top = `${Math.min(rect.bottom + 8, window.innerHeight - popup.offsetHeight - 12)}px`;
          };
          const onScroll = () => position();

          const mount = (props: SuggestionProps<SlashMenuItem>) => {
            if (!popup || !root) {
              popup = document.createElement('div');
              popup.style.position = 'fixed';
              popup.style.zIndex = '50';
              document.body.appendChild(popup);
              root = createRoot(popup);
              document.addEventListener('scroll', onScroll, true);
            }
            getRect = props.clientRect;
            root.render(
              <SlashMenuList
                ref={(h) => {
                  handle = h;
                }}
                items={props.items}
                command={(item) => props.command(item)}
              />,
            );
            position();
          };

          const unmount = () => {
            document.removeEventListener('scroll', onScroll, true);
            root?.unmount();
            popup?.remove();
            root = null;
            popup = null;
            handle = null;
            getRect = null;
          };

          return {
            onStart: (props) => {
              dismissed = false;
              mount(props);
            },
            onUpdate: (props) => {
              if (dismissed) return;
              mount(props);
            },
            onKeyDown: ({ event, view }: SuggestionKeyDownProps) => {
              if (event.key === 'Escape') {
                dismissed = true;
                exitSuggestion(view, SLASH_KEY);
                return true;
              }
              return handle?.onKeyDown(event) ?? false;
            },
            onExit: unmount,
          };
        },
      }),
    ];
  },
});
