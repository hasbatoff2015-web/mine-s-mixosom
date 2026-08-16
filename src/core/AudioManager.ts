export class AudioManager {
  masterVolume = 0.7;
  muted = false;
  private context?: AudioContext;
  private paused = false;

  setVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  pause(): void {
    this.paused = true;
    void this.context?.suspend();
  }

  resume(): void {
    this.paused = false;
    void this.context?.resume();
  }

  playTone(frequency: number, duration = 0.06, gain = 0.035): void {
    if (this.muted || this.paused || this.masterVolume <= 0) return;
    const AudioContextClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    this.context ??= new AudioContextClass();
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    const now = this.context.currentTime;
    oscillator.type = 'square';
    oscillator.frequency.value = frequency;
    envelope.gain.setValueAtTime(gain * this.masterVolume, now);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(envelope).connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }
}
