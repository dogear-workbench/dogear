import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { client } from '@/lib/client';
import { registerDataSink, useTerminalStore } from '@/stores/terminal-store';

interface XtermEntry {
  host: HTMLDivElement;
  term: Terminal;
  fit: FitAddon;
  opened: boolean;
  hydrated: boolean;
  pending: string[];
  lastCols: number;
  lastRows: number;
}

const entryCache = new Map<string, XtermEntry>();

function getEntry(terminalId: string): XtermEntry {
  const cached = entryCache.get(terminalId);
  if (cached) return cached;
  const host = document.createElement('div');
  host.className = 'h-full w-full';
  const term = new Terminal({
    scrollback: 5000,
    fontSize: 12,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    cursorBlink: true,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  const entry: XtermEntry = { host, term, fit, opened: false, hydrated: false, pending: [], lastCols: 0, lastRows: 0 };
  entryCache.set(terminalId, entry);
  return entry;
}

export function XtermTerminal({ terminalId }: { terminalId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const meta = useTerminalStore((s) => s.terminals.get(terminalId));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const entry = getEntry(terminalId);
    container.appendChild(entry.host);
    if (!entry.opened) {
      entry.term.open(entry.host);
      entry.opened = true;
    }

    if (!entry.hydrated) {
      void (async () => {
        try {
          const snapshot = await client.getPtyBuffer({ terminalId });
          if (snapshot?.buffer) entry.term.write(snapshot.buffer);
        } catch (error) {
          console.warn('[terminal] 拉取历史失败:', error);
        } finally {
          entry.hydrated = true;
          for (const chunk of entry.pending) entry.term.write(chunk);
          entry.pending = [];
        }
      })();
    }

    const offSink = registerDataSink(terminalId, (data) => {
      if (!entry.hydrated) {
        entry.pending.push(data);
        return;
      }
      entry.term.write(data);
    });

    const dataListener = entry.term.onData((data) => {
      if (useTerminalStore.getState().terminals.get(terminalId)?.exited) return;
      client.ptyWrite({ terminalId, data }).catch((error) => {
        console.warn('[terminal] 写入失败:', error);
      });
    });

    const syncSize = () => {
      if (!entry.opened) return;
      try {
        entry.fit.fit();
      } catch {
        return;
      }
      if (entry.term.cols === entry.lastCols && entry.term.rows === entry.lastRows) return;
      entry.lastCols = entry.term.cols;
      entry.lastRows = entry.term.rows;
      client.ptyResize({ terminalId, cols: entry.term.cols, rows: entry.term.rows }).catch(() => {});
    };
    syncSize();

    const observer = new ResizeObserver(syncSize);
    observer.observe(container);

    return () => {
      offSink();
      dataListener.dispose();
      observer.disconnect();
      entry.host.remove();
    };
  }, [terminalId]);

  return (
    <div className="relative h-full w-full min-h-0">
      <div ref={containerRef} className="absolute inset-0 p-1" />
      {meta?.exited && (
        <div className="absolute inset-x-0 bottom-0 flex h-7 items-center border-t bg-muted/90 px-2 text-xs text-muted-foreground select-none">
          进程已退出{meta.exitCode !== undefined ? `（exit ${meta.exitCode}）` : ''}
        </div>
      )}
    </div>
  );
}
