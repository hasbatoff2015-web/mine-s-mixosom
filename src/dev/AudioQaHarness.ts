import { catalogFiles, resolveCatalogEvent, sfxAssetBaseUrl } from '../audio/soundCatalog';
import { worldSoundPlayOptions } from '../audio/worldSoundPlayback';
import type { SoundEventId } from '../audio/soundEvents';
import { AudioManager } from '../core/AudioManager';
import { parseServerMessage } from '../../shared/protocol';

/** Dev-only browser probe for the exact catalog → fetch → decode → playback path. */
export async function startAudioQaHarness(uiRoot: HTMLElement): Promise<() => void> {
  const audio = new AudioManager();
  const panel = document.createElement('section');
  panel.style.cssText = 'position:fixed;inset:20px auto auto 20px;z-index:10;padding:18px;background:#182027;color:white;font:14px monospace;max-width:680px';
  const button = document.createElement('button');
  button.textContent = 'Play parsed world_sound Totem packet';
  const status = document.createElement('pre');
  panel.append(button, status);
  uiRoot.replaceChildren(panel);
  const report = (detail: Record<string, unknown> = {}) => {
    status.textContent = JSON.stringify({ catalogHasTotem: catalogFiles().includes('totem-sound.mp3'),
      profile: resolveCatalogEvent('totem.activate'), ...detail, audio: audio.debugSnapshot() }, null, 2);
  };
  report({ state: 'preloading' });
  await audio.preload();
  const response = await fetch(`${sfxAssetBaseUrl(import.meta.env.BASE_URL)}totem-sound.mp3`);
  const context = new AudioContext();
  const decoded = await context.decodeAudioData(await response.arrayBuffer());
  const samples = decoded.getChannelData(0);
  const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
  const firstSecondRms = Math.sqrt(samples.slice(0, decoded.sampleRate)
    .reduce((sum, sample) => sum + sample * sample, 0) / decoded.sampleRate);
  report({ state: 'decoded', fetchedUrl: response.url, httpStatus: response.status,
    duration: decoded.duration, sampleRate: decoded.sampleRate, rms, firstSecondRms });
  button.onclick = () => {
    audio.resume();
    const packet = parseServerMessage({ type: 'world_sound', sounds: [
      { event: 'totem.activate', x: 0, y: 0, z: 0 },
    ] });
    if (!('error' in packet) && packet.type === 'world_sound') {
      for (const sound of packet.sounds) {
        if (!resolveCatalogEvent(sound.event as SoundEventId)) continue;
        audio.playAt(sound.event as SoundEventId, sound, { x: 0, y: 0, z: 0 }, worldSoundPlayOptions());
      }
    }
    report({ state: 'parsed packet played', parsed: packet, fetchedUrl: response.url, rms });
    setTimeout(() => report({ state: 'after playback start', fetchedUrl: response.url, rms }), 300);
  };
  return () => { button.onclick = null; audio.pause(); void context.close(); panel.remove(); };
}
