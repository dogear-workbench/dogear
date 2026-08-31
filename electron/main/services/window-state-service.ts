import path from 'path';
import { safeJsonRead, safeJsonWrite } from './safe-json.js';
import { getConfigDir } from './settings-service.js';

export interface WindowBounds {
  x: number | null;
  y: number | null;
  width: number;
  height: number;
}

interface WindowStateFile {
  version: 1;
  windows: Record<string, WindowBounds>;
}

function getStatePath(): string {
  return path.join(getConfigDir(), 'window-state.json');
}

function isValidBounds(value: unknown): value is WindowBounds {
  if (typeof value !== 'object' || value === null) return false;
  const b = value as Record<string, unknown>;
  return (
    typeof b.width === 'number' && Number.isFinite(b.width) && b.width > 0 &&
    typeof b.height === 'number' && Number.isFinite(b.height) && b.height > 0 &&
    (b.x === null || typeof b.x === 'number') &&
    (b.y === null || typeof b.y === 'number')
  );
}

async function loadStateFile(): Promise<WindowStateFile> {
  const file = await safeJsonRead<WindowStateFile | null>(getStatePath(), null);
  if (file && file.version === 1 && typeof file.windows === 'object' && file.windows !== null) {
    return file;
  }
  return { version: 1, windows: {} };
}

export async function loadWindowBounds(key: string): Promise<WindowBounds | null> {
  const file = await loadStateFile();
  const bounds = file.windows[key];
  return isValidBounds(bounds) ? bounds : null;
}

export async function saveWindowBounds(key: string, bounds: WindowBounds): Promise<void> {
  const file = await loadStateFile();
  file.windows[key] = bounds;
  await safeJsonWrite(getStatePath(), file);
}
