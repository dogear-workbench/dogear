import { useSettingsStore } from '@/stores/settings-store';

type SoundKind = 'complete' | 'permission' | 'error';

let audioContext: AudioContext | null = null;
let lastPlayedAt = 0;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return null;
  audioContext ??= new AudioContext();
  return audioContext;
}

/** 使用 Web Audio API 合成 Dogear 自己的短提示音，不调用 Windows 系统音效。 */
export function playDogearSound(kind: SoundKind, options?: { force?: boolean }): void {
  const sound = useSettingsStore.getState().settings.ui?.sound;
  if (sound?.enabled === false) return;
  if (!options?.force && sound?.backgroundOnly !== false && document.visibilityState === 'visible' && document.hasFocus()) return;

  const now = Date.now();
  if (now - lastPlayedAt < 1200) return;
  lastPlayedAt = now;

  const context = getAudioContext();
  if (!context) return;
  void context.resume().then(() => {
    const current = context.currentTime;
    const volume = Math.max(0, Math.min(1, sound?.volume ?? 0.25));
    const notes: Record<SoundKind, number[]> = {
      complete: [660, 880],
      permission: [880, 660, 880],
      error: [440, 330],
    };
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.connect(gain);
    gain.connect(context.destination);
    gain.gain.setValueAtTime(0.0001, current);
    const noteLength = kind === 'permission' ? 0.11 : 0.14;
    notes[kind].forEach((frequency, index) => {
      const start = current + index * noteLength;
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + noteLength - 0.015);
    });
    oscillator.start(current);
    oscillator.stop(current + notes[kind].length * noteLength);
  }).catch(() => {
    // 音频设备不可用或上下文被浏览器策略阻止时不影响主流程。
  });
}
