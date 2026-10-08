export interface HotfixInfo {
  url: string;
  size: number;
  sha256: string;
}

export interface FullInfo {
  url: string;
  size: number;
  sha256: string;
  blockmapUrl?: string;
}

export interface ReleaseInfo {
  version: string;
  type: 'hotfix' | 'full';
  pubDate: string;
  hotfix?: HotfixInfo;
  full?: FullInfo;
}

export interface ManifestInfo extends ReleaseInfo {
  platforms?: Partial<Record<string, ReleaseInfo>>;
}

export interface CheckResult {
  hasUpdate: boolean;
  type?: 'hotfix' | 'full';
  info?: ReleaseInfo;
  error?: string;
}

export function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const a = parts1[i] || 0;
    const b = parts2[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

// 旧扁平 manifest 是 win-only 形态；darwin 读它只会拿到 win 产物，必须视为无更新
export function pickPlatformRelease(
  manifest: ManifestInfo,
  platform: string = process.platform,
): ReleaseInfo | null {
  const platformInfo = manifest.platforms?.[platform];
  if (platformInfo) return platformInfo;
  return platform === 'win32' ? manifest : null;
}
