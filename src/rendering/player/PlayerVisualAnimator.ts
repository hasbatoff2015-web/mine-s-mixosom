import * as THREE from 'three';

export interface PlayerAnimationState {
  readonly viewYaw: number;
  readonly viewPitch: number;
  readonly movementSpeed: number;
  readonly onGround: boolean;
  readonly sneaking: boolean;
  readonly sprinting: boolean;
  readonly verticalVelocity: number;
  readonly mining: boolean;
  readonly bowCharge: number;
  readonly swordBlocking: boolean;
  readonly foodUseProgress: number;
}

export interface PlayerVisualPose {
  readonly bodyYaw: number;
  readonly headYaw: number;
  readonly headPitch: number;
  readonly bodyPitch: number;
  readonly bodyYOffset: number;
  readonly bodyZOffset: number;
  readonly rightArmX: number;
  readonly rightArmY: number;
  readonly rightArmZ: number;
  readonly leftArmX: number;
  readonly leftArmY: number;
  readonly leftArmZ: number;
  readonly rightLegX: number;
  readonly leftLegX: number;
  readonly swingProgress: number;
}

export function wrapRadians(value: number): number {
  return THREE.MathUtils.euclideanModulo(value + Math.PI, Math.PI * 2) - Math.PI;
}

export function dampAngle(current: number, target: number, rate: number, deltaSeconds: number): number {
  return current + wrapRadians(target - current) * (1 - Math.exp(-Math.max(0, deltaSeconds) * rate));
}

/** Render-frame animator. It consumes fixed-tick state but never mutates gameplay authority. */
export class PlayerVisualAnimator {
  private bodyYaw = 0;
  private initialized = false;
  private walkPhase = 0;
  private walkStrength = 0;
  private swingSeconds = 1;
  private elapsedSeconds = 0;

  reset(viewYaw = 0): void {
    this.bodyYaw = viewYaw;
    this.initialized = true;
    this.walkPhase = 0;
    this.walkStrength = 0;
    this.swingSeconds = 1;
    this.elapsedSeconds = 0;
  }

  triggerSwing(): void {
    this.swingSeconds = 0;
  }

  advance(deltaSeconds: number, state: Readonly<PlayerAnimationState>): PlayerVisualPose {
    const delta = THREE.MathUtils.clamp(deltaSeconds, 0, 0.1);
    if (!this.initialized) this.reset(state.viewYaw);
    this.swingSeconds += delta;
    this.elapsedSeconds += delta;

    const moving = state.movementSpeed > 0.05;
    const relativeHead = wrapRadians(state.viewYaw - this.bodyYaw);
    const maximumHeadYaw = THREE.MathUtils.degToRad(72);
    const desiredBodyYaw = moving
      ? state.viewYaw
      : Math.abs(relativeHead) > maximumHeadYaw
        ? state.viewYaw - Math.sign(relativeHead) * maximumHeadYaw
        : this.bodyYaw;
    this.bodyYaw = dampAngle(this.bodyYaw, desiredBodyYaw, moving ? 9 : 6, delta);
    const headYaw = THREE.MathUtils.clamp(wrapRadians(state.viewYaw - this.bodyYaw), -maximumHeadYaw, maximumHeadYaw);

    const targetWalk = state.onGround
      ? THREE.MathUtils.clamp(state.movementSpeed / 4.3, 0, 1) * (state.sprinting ? 1.18 : 1)
      : 0;
    this.walkStrength += (targetWalk - this.walkStrength) * Math.min(1, delta * 10);
    this.walkPhase += delta * (4.8 + state.movementSpeed * 1.55);
    const stride = Math.sin(this.walkPhase) * this.walkStrength;
    let rightLegX = stride;
    let leftLegX = -stride;
    let rightArmX = -stride * 0.78;
    let leftArmX = stride * 0.78;
    let rightArmY = 0;
    let leftArmY = 0;
    let rightArmZ = 0.04;
    let leftArmZ = -0.04;

    if (!state.onGround) {
      const falling = state.verticalVelocity < -0.05;
      rightLegX = falling ? 0.18 : -0.18;
      leftLegX = falling ? -0.18 : 0.18;
      rightArmX -= falling ? 0.16 : -0.12;
      leftArmX -= falling ? 0.16 : -0.12;
    }

    const explicitProgress = THREE.MathUtils.clamp(this.swingSeconds / 0.32, 0, 1);
    const miningProgress = (this.elapsedSeconds * 3.2) % 1;
    const swingProgress = explicitProgress < 1 ? explicitProgress : state.mining ? miningProgress : 1;
    const swinging = explicitProgress < 1 || state.mining;
    const swingArc = swinging ? Math.sin(Math.sqrt(swingProgress) * Math.PI) : 0;
    if (swinging) {
      rightArmX += 1.65 * swingArc;
      rightArmY -= 0.42 * swingArc;
      rightArmZ += 0.24 * swingArc;
    }

    if (state.foodUseProgress > 0) {
      const cadence = Math.abs(Math.cos(state.foodUseProgress * Math.PI * 8));
      rightArmX = 1.18 - cadence * 0.12;
      rightArmY = -0.38;
      rightArmZ = 0.18;
    }

    if (state.swordBlocking) {
      rightArmX = 0.86;
      rightArmY = -0.62;
      rightArmZ = 0.42;
    }

    if (state.bowCharge > 0) {
      const aim = Math.PI / 2 - state.viewPitch;
      rightArmX = aim;
      leftArmX = aim;
      rightArmY = headYaw - 0.12;
      leftArmY = headYaw + 0.62;
      rightArmZ = 0;
      leftArmZ = 0;
    }

    return {
      bodyYaw: this.bodyYaw,
      headYaw,
      headPitch: state.viewPitch,
      bodyPitch: state.sneaking ? -0.48 : 0,
      bodyYOffset: state.sneaking ? -0.10 : 0,
      bodyZOffset: state.sneaking ? -0.10 : 0,
      rightArmX,
      rightArmY,
      rightArmZ,
      leftArmX,
      leftArmY,
      leftArmZ,
      rightLegX,
      leftLegX,
      swingProgress,
    };
  }
}
