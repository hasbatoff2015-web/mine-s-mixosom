import * as THREE from 'three';
import { BlockId } from '../blocks';
import type { GameSession } from '../core/Game';
import type { InputManager } from '../input/InputManager';
import type { MobEntity } from '../entities/MobManager';

/** Explicit dev UI, only mounted in the opt-in QA seed. All operations run the
 * real Game/World/managers, never a second simulation or browser-injected state.
 */
export function mountGameplayPolishQa(session: GameSession, input: InputManager,
  actions: { use(): void; break(): void }): () => void {
  const panel = document.createElement('div');
  panel.id = 'gameplay-polish-qa';
  panel.style.cssText = 'position:fixed;right:8px;top:8px;max-width:400px;z-index:10000;background:#112e;color:white;padding:10px;pointer-events:auto;font:12px monospace';
  const label = document.createElement('div'); label.textContent = 'DEV POLISH QA · test world only';
  panel.append(label);
  const output = document.createElement('pre');
  let targetMob: MobEntity | undefined;
  let peak = 0;
  let previousMobY = 0;
  let trace = '';
  const { world, player } = session;
  function look(position: readonly [number, number, number], at: readonly [number, number, number]) {
    player.teleport(position);
    const direction = new THREE.Vector3(...at).sub(player.eyePosition());
    input.yaw = player.yaw = Math.atan2(-direction.x, -direction.z);
    input.pitch = player.pitch = Math.atan2(direction.y, Math.hypot(direction.x, direction.z));
    input.releaseActions();
  }
  function set(x: number, y: number, z: number, block: BlockId) {
    world.applyBlockBatch([{ x, y, z, block }], { deferLighting: true });
    session.redstone.notifyBlockChanged(x, y, z);
  }
  function button(name: string, run: () => void) {
    const button = document.createElement('button'); button.textContent = name;
    button.style.cssText = 'margin:3px;padding:5px;background:#ddd;color:#111;border:1px solid #888';
    button.onclick = run; panel.append(button);
  }
  button('Build QA platform', () => {
    const edits = [];
    for (let x = 4; x <= 12; x++) for (let z = 4; z <= 14; z++) for (let y = 71; y <= 77; y++) {
      edits.push({ x, y, z, block: y === 71 ? BlockId.Stone : BlockId.Air });
    }
    world.applyBlockBatch(edits, { deferLighting: true });
    session.mobs.clear(); session.drops.clear();
    set(6, 72, 8, BlockId.Lever);
    session.redstone.setLeverOrientation(6, 72, 8, 'floor', 'north');
    set(8, 73, 7, BlockId.Stone); set(8, 73, 8, BlockId.StoneButton);
    session.redstone.setButtonOrientation(8, 73, 8, 'wall', 'south');
    set(10, 72, 8, BlockId.Torch); world.setBlockState(10, 72, 8, { attachment: 'floor' });
    set(10, 73, 7, BlockId.Stone); set(10, 73, 8, BlockId.Torch);
    world.setBlockState(10, 73, 8, { attachment: 'wall', facing: 'south' });
    look([8.5, 72, 12.5], [8.5, 73, 8.5]);
  });
  button('Aim floor lever', () => look([6.5, 72, 10.9], [6.5, 72.1, 8.5]));
  button('Aim wall button', () => look([8.5, 72, 10.9], [8.5, 73.5, 8.06]));
  button('Use targeted (Game)', actions.use);
  button('Break targeted (Game)', actions.break);
  button('Remove control supports', () => {
    set(6, 71, 8, BlockId.Air); set(8, 73, 7, BlockId.Air);
    look([8.5, 72, 11.5], [7.5, 72.7, 8.5]);
  });
  button('Water → both torches', () => {
    // Source behind + adjacent to both torches, bounded channel.
    for (let x = 9; x <= 11; x++) {
      set(x, 72, 7, BlockId.Stone); set(x, 72, 9, BlockId.Stone);
    }
    set(11, 72, 8, BlockId.Stone);
    set(9, 72, 8, BlockId.Stone);
    set(8, 73, 8, BlockId.Stone);
    set(9, 73, 7, BlockId.Stone); set(9, 73, 9, BlockId.Stone);
    set(9, 73, 8, BlockId.Water);
    look([11.9, 72, 11.8], [10, 73, 8.5]);
  });
  button('Shoot 5 arrows into log', () => {
    for (let y = 72; y <= 75; y++) set(8, y, 6, BlockId.OakLog);
    for (let i = 0; i < 5; i++) session.arrows.spawn(new THREE.Vector3(8.15 + i * 0.16, 74, 9),
      new THREE.Vector3(0, 0, -1), 2, 4, false);
    look([10.5, 72, 9.5], [8.5, 74, 6.5]);
  });
  button('Remove arrow log', () => {
    for (let y = 72; y <= 75; y++) set(8, y, 6, BlockId.Air);
  });
  function mobHit(sprint: boolean) {
    session.mobs.clear();
    world.timeOfDay = 18000;
    targetMob = session.mobs.spawn('zombie', new THREE.Vector3(7, 72, 10), { force: true });
    if (!targetMob) return;
    targetMob.onGround = true; targetMob.facingYaw = Math.PI / 2;
    targetMob.previousFacingYaw = targetMob.facingYaw;
    session.mobs.damage(targetMob, 1, { source: 'player', attackerPosition: new THREE.Vector3(6, 72, 10),
      attackerYaw: -Math.PI / 2, extraKnockbackLevel: Number(sprint) });
    peak = 72; previousMobY = 72; trace = sprint ? 'sprint' : 'normal';
    look([8.5, 72, 14], [8.5, 73, 10]);
  }
  button('Normal mob hit', () => mobHit(false));
  button('Sprint mob hit', () => mobHit(true));
  panel.append(output); document.body.append(panel);
  const timer = window.setInterval(() => {
    if (targetMob?.alive) {
      peak = Math.max(peak, targetMob.position.y);
      previousMobY = targetMob.position.y;
    }
    output.textContent = [
      `target=${session.target ? BlockId[session.target.block] : 'none'} drops=${session.drops.count} arrows=${session.arrows.count}`,
      `lever=${world.getBlockState(6, 72, 8)?.powered} button=${world.getBlockState(8, 73, 8)?.powered}`,
      `torch cells=${BlockId[world.getBlock(10, 72, 8, false)]}/${BlockId[world.getBlock(10, 73, 8, false)]}`,
      `${trace} mob y=${previousMobY.toFixed(3)} peak(sampled)=${(peak - 72).toFixed(3)} yaw=${targetMob?.facingYaw.toFixed(3)}`,
    ].join('\n');
  }, 50);
  return () => { window.clearInterval(timer); panel.remove(); };
}
