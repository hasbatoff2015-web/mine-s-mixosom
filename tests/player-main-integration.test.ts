import { describe, expect, it } from 'vitest';
import gameSource from '../src/core/Game.ts?raw';
import inputSource from '../src/input/InputManager.ts?raw';

function section(start: string, end: string): string {
  const from = gameSource.indexOf(start);
  const to = gameSource.indexOf(end, from + start.length);
  expect(from, start).toBeGreaterThanOrEqual(0);
  expect(to, end).toBeGreaterThan(from);
  return gameSource.slice(from, to);
}

describe('player visuals on the server-authoritative main integration', () => {
  it('keeps Online Anarchy headless simulation authoritative while updating presentation inventory', () => {
    const online = section('private tickOnline(', 'private tick():');
    expect(online).toContain("type: 'input'");
    expect(online).toContain('predictLocalMove');
    expect(online).toContain('this.syncLocalCreativeFlight(session)');
    expect(online.indexOf('this.syncLocalCreativeFlight(session)')).toBeLessThan(online.indexOf('predictLocalMove'));
    expect(online).toContain('flushPendingLocalSnapshot');
    expect(online).toContain('session.playerVisual.setHeldItem(selected?.itemId)');
    expect(online).not.toContain('stepTowardTarget');
    expect(online).not.toContain('ingestAuthoritativePosition');
    expect(online).not.toContain('session.world.tick()');
    expect(online).not.toContain('session.falling.update(');
    const applyState = section('private applyLocalPlayerSnapshot(', 'private noteLocalSnapshotTiming(');
    expect(applyState).toContain('reconcilePredictedPlayer');
    expect(applyState.indexOf('this.syncLocalCreativeFlight')).toBeLessThan(applyState.indexOf('reconcilePredictedPlayer'));
    expect(applyState).not.toContain('stepTowardTarget');
    expect(applyState).not.toContain('ingestAuthoritativePosition');
    const recvState = section('private applyOnlinePlayerState(', 'private observeLocalPlayerSnapshot(');
    expect(recvState).toContain('pendingLocalSnapshot');
    expect(recvState).not.toContain('stepTowardTarget');
    const jobs = section('private processWorldJobs(', 'private queueUrgentMutationMesh(');
    expect(jobs).toContain('drainUrgentMutationMesh');
    expect(jobs).not.toContain('WORLD_JOB_BUDGET_MS +');
  });

  it('keeps reach and block targeting on the canonical player eye plus live input look rather than the presentation camera', () => {
    const targeting = section('private sampleLocalAim(', 'private miningDelta(');
    expect(targeting).toContain('localInteractionAim(');
    expect(targeting).toContain('session.world.raycast(origin, direction, PLAYER_REACH)');
    expect(targeting).toContain('this.refreshLocalCrosshair(session)');
    expect(targeting).not.toContain('session.player.viewDirection()');
    expect(targeting).not.toContain('this.camera.position');
    expect(targeting).not.toContain('this.camera.getWorldDirection');
    const render = section('private render(alpha:', 'private updatePlayerPresentation(');
    expect(render).toContain('this.refreshLocalCrosshair(session)');
    expect(render).not.toContain('this.camera.getWorldDirection');
  });

  it('runs local/remote player presentation and the accepted breaking overlay on the render path', () => {
    const render = section('private render(alpha:', 'private updatePlayerPresentation(');
    expect(render).toContain('this.updatePlayerPresentation(session, position, now)');
    expect(render).toContain('this.interpolatedPlayerPosition');
    expect(render).toContain('motionProbe.recordRender');
    expect(render).toContain('remote.interpolate(');
    expect(render).toContain('applyInterpolatedEntityVisuals(');
    expect(render).toContain('this.updateBreakingOverlay()');
    const overlay = section('private updateBreakingOverlay(', 'private refreshHud(');
    expect(overlay).toContain('session.worldRenderer.setBreakingProgress(');
    expect(overlay).not.toContain('cameraPerspective');
  });

  it('keeps camera toggle edge-triggered on physical KeyC and does not clear held keys or touch lifecycle/network state', () => {
    const helperStart = inputSource.indexOf('export function shouldCyclePerspectiveOnKey');
    const helperEnd = inputSource.indexOf('export class InputManager', helperStart);
    const helper = inputSource.slice(helperStart, helperEnd);
    expect(helper).toContain('DESKTOP_CAMERA_TOGGLE_CODE');
    expect(helper).not.toContain("input.code === 'F5'");
    expect(helper).not.toMatch(/event\.key\s*===?\s*['"]c['"]/i);
    expect(helper).not.toMatch(/event\.key\s*===?\s*['"]с['"]/i);
    expect(helper).toContain('input.code === DESKTOP_CAMERA_TOGGLE_CODE');
    expect(helper).toContain('!input.repeat');
    expect(helper).toContain('input.canCapture()');
    expect(helper).not.toContain('clearHeldKeys');
    expect(inputSource).toContain("export const DESKTOP_CAMERA_TOGGLE_CODE = 'KeyC'");
    expect(inputSource).toContain("export const DESKTOP_SNEAK_CODES = ['ShiftLeft', 'ShiftRight']");
    expect(inputSource).toContain('sprint: this.touchSprint');
    expect(inputSource).not.toContain('DESKTOP_SPRINT_CODES');
    expect(inputSource).not.toMatch(/shouldCyclePerspectiveOnKey[\s\S]*F5/);
    expect(inputSource).not.toContain("event.code === 'F5'");
    expect(inputSource).toContain('const length = Math.hypot(forward, right)');
    expect(inputSource).toContain("this.keys.has('KeyW')");
    expect(inputSource).toContain("this.keys.has('Space')");
    expect(inputSource).toContain("event.code === 'KeyE'");
    expect(inputSource).toContain('this.keys.add(event.code)');
    const cycle = section('private cycleCameraPerspective(', 'private bindLifecycle(');
    expect(cycle).toContain('setCameraPerspective(nextCameraPerspective(');
    expect(cycle).not.toContain('teleport');
    expect(cycle).not.toContain('inputSeq');
    expect(cycle).not.toContain('disconnect');
  });
});
