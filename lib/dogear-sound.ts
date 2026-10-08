import { useSettingsStore } from '@/stores/settings-store';

type SoundKind = 'complete' | 'permission' | 'error' | 'intervention';

let audioContext: AudioContext | null = null;
let lastPlayedAt = 0;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return null;
  audioContext ??= new AudioContext();
  return audioContext;
}

/** 使用 Web Audio API 合成 Dogear 自己的短提示音，不调用 Windows 系统音效。 */
export function playDogearSound(kind: SoundKind, options?: { force?: boolean; volume?: number }): void {
  const sound = useSettingsStore.getState().settings.ui?.sound;
  if (sound?.enabled === false) return;
  if (!options?.force && sound?.backgroundOnly !== false && document.visibilityState === 'visible' && document.hasFocus()) return;

  const volume = Math.max(0, Math.min(1, options?.volume ?? sound?.volume ?? 0.25));
  if (volume <= 0) return;

  const now = Date.now();
  if (now - lastPlayedAt < 1200) return;
  lastPlayedAt = now;

  const context = getAudioContext();
  if (!context) return;
  void context.resume().then(() => {
    const current = context.currentTime;
    const notes: Record<SoundKind, number[]> = {
      complete: [660, 880],
      permission: [880, 660, 880],
      intervention: [880, 660, 880],
      error: [440, 330],
    };
    const noteLength = kind === 'permission' || kind === 'intervention' ? 0.11 : 0.14;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.ratio.value = 10;
    compressor.attack.value = 0.002;
    compressor.release.value = 0.12;
    compressor.connect(context.destination);
    const masterGain = context.createGain();
    masterGain.gain.value = volume * 2.5;
    masterGain.connect(compressor);
    notes[kind].forEach((frequency, index) => {
      const start = current + index * noteLength;
      const envelope = context.createGain();
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.exponentialRampToValueAtTime(1, start + 0.005);
      envelope.gain.setValueAtTime(1, start + noteLength - 0.015);
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + noteLength);
      envelope.connect(masterGain);
      [1, 2].forEach((multiplier) => {
        const voiceGain = context.createGain();
        voiceGain.gain.value = multiplier === 1 ? 1 : 0.4;
        voiceGain.connect(envelope);
        const oscillator = context.createOscillator();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency * multiplier;
        oscillator.connect(voiceGain);
        oscillator.start(start);
        oscillator.stop(start + noteLength);
      });
    });
  }).catch(() => {
    // 音频设备不可用或上下文被浏览器策略阻止时不影响主流程。
  });
}
