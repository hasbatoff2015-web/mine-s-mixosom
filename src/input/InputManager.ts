import { clamp } from '../core/constants';

export interface InputCallbacks {
  canCapture(): boolean;
  toggleInventory(): void;
  togglePause(): void;
  dropItem(): void;
  selectHotbar(index: number): void;
}

export interface MoveInput {
  forward: number;
  right: number;
  jump: boolean;
  sprint: boolean;
  sneak: boolean;
}

export class InputManager {
  yaw = 0;
  pitch = 0;
  mining = false;
  using = false;
  attackPressed = false;
  usePressed = false;
  private readonly keys = new Set<string>();
  private touchForward = 0;
  private touchRight = 0;
  private touchJump = false;
  private touchSprint = false;
  private touchSneak = false;
  private activeLookPointer?: number;
  private lastLookX = 0;
  private lastLookY = 0;
  private sensitivity = 0.0022;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: InputCallbacks,
  ) {
    this.bindDesktop();
    this.bindTouch();
  }

  setSensitivity(value: number): void {
    this.sensitivity = clamp(value, 0.0005, 0.006);
  }

  movement(): MoveInput {
    const forward = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS')) + this.touchForward;
    const right = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA')) + this.touchRight;
    const length = Math.hypot(forward, right);
    return {
      forward: length > 1 ? forward / length : forward,
      right: length > 1 ? right / length : right,
      jump: this.keys.has('Space') || this.touchJump,
      sprint: this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.touchSprint,
      sneak: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchSneak,
    };
  }

  consumeAttackPressed(): boolean {
    const value = this.attackPressed;
    this.attackPressed = false;
    return value;
  }

  consumeUsePressed(): boolean {
    const value = this.usePressed;
    this.usePressed = false;
    return value;
  }

  releaseActions(): void {
    this.mining = false;
    this.using = false;
    this.attackPressed = false;
    this.usePressed = false;
    this.touchJump = false;
  }

  private bindDesktop(): void {
    window.addEventListener('keydown', (event) => {
      if (event.code === 'KeyE' && !event.repeat) {
        event.preventDefault();
        this.callbacks.toggleInventory();
        return;
      }
      if (event.code === 'Escape' && !event.repeat) {
        this.callbacks.togglePause();
        return;
      }
      if (event.code === 'KeyQ' && !event.repeat) {
        this.callbacks.dropItem();
        return;
      }
      if (/^Digit[1-9]$/.test(event.code) && !event.repeat) {
        this.callbacks.selectHotbar(Number(event.code.slice(-1)) - 1);
      }
      this.keys.add(event.code);
    });
    window.addEventListener('keyup', (event) => this.keys.delete(event.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.releaseActions();
    });

    this.canvas.addEventListener('click', () => {
      if (this.callbacks.canCapture() && document.pointerLockElement !== this.canvas) void this.canvas.requestPointerLock();
    });
    document.addEventListener('mousemove', (event) => {
      if (document.pointerLockElement !== this.canvas) return;
      this.rotate(event.movementX, event.movementY);
    });
    this.canvas.addEventListener('mousedown', (event) => {
      if (!this.callbacks.canCapture()) return;
      if (event.button === 0) {
        this.mining = true;
        this.attackPressed = true;
      }
      if (event.button === 2) {
        this.using = true;
        this.usePressed = true;
      }
    });
    window.addEventListener('mouseup', (event) => {
      if (event.button === 0) this.mining = false;
      if (event.button === 2) this.using = false;
    });
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    this.canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      const current = Number(this.canvas.dataset.hotbar ?? 0);
      const next = (current + Math.sign(event.deltaY) + 9) % 9;
      this.callbacks.selectHotbar(next);
    }, { passive: false });
  }

  private bindTouch(): void {
    const joystick = document.createElement('div');
    joystick.id = 'touch-joystick';
    joystick.innerHTML = '<div class="joystick-ring"><div class="joystick-knob"></div></div>';
    const actions = document.createElement('div');
    actions.id = 'touch-actions';
    actions.innerHTML = [
      '<button data-action="mine" aria-label="Ломать или атаковать">⛏</button>',
      '<button data-action="use" aria-label="Использовать или поставить">▣</button>',
      '<button data-action="jump" aria-label="Прыжок">↑</button>',
      '<button data-action="sneak" aria-label="Присесть">⌄</button>',
      '<button data-action="sprint" aria-label="Бег">»</button>',
      '<button data-action="inventory" aria-label="Инвентарь">▦</button>',
      '<button data-action="pause" aria-label="Пауза">Ⅱ</button>',
    ].join('');
    const look = document.createElement('div');
    look.id = 'touch-look-zone';
    document.querySelector('#app')?.append(look, joystick, actions);

    let joystickPointer: number | undefined;
    const knob = joystick.querySelector<HTMLElement>('.joystick-knob')!;
    const updateJoystick = (event: PointerEvent) => {
      const rect = joystick.getBoundingClientRect();
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - (rect.top + rect.height / 2);
      const radius = rect.width * 0.34;
      const scale = Math.min(1, radius / Math.max(radius, Math.hypot(dx, dy)));
      const x = dx * scale;
      const y = dy * scale;
      knob.style.transform = `translate(${x}px, ${y}px)`;
      this.touchRight = x / radius;
      this.touchForward = -y / radius;
    };
    joystick.addEventListener('pointerdown', (event) => {
      joystickPointer = event.pointerId;
      joystick.setPointerCapture(event.pointerId);
      updateJoystick(event);
    });
    joystick.addEventListener('pointermove', (event) => {
      if (event.pointerId === joystickPointer) updateJoystick(event);
    });
    const releaseJoystick = (event: PointerEvent) => {
      if (event.pointerId !== joystickPointer) return;
      joystickPointer = undefined;
      this.touchForward = 0;
      this.touchRight = 0;
      knob.style.transform = '';
    };
    joystick.addEventListener('pointerup', releaseJoystick);
    joystick.addEventListener('pointercancel', releaseJoystick);

    look.addEventListener('pointerdown', (event) => {
      if (!this.callbacks.canCapture()) return;
      this.activeLookPointer = event.pointerId;
      this.lastLookX = event.clientX;
      this.lastLookY = event.clientY;
      look.setPointerCapture(event.pointerId);
    });
    look.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this.activeLookPointer) return;
      this.rotate((event.clientX - this.lastLookX) * 1.35, (event.clientY - this.lastLookY) * 1.35);
      this.lastLookX = event.clientX;
      this.lastLookY = event.clientY;
    });
    const stopLook = (event: PointerEvent) => {
      if (event.pointerId === this.activeLookPointer) this.activeLookPointer = undefined;
    };
    look.addEventListener('pointerup', stopLook);
    look.addEventListener('pointercancel', stopLook);

    for (const button of actions.querySelectorAll<HTMLButtonElement>('button')) {
      const action = button.dataset.action;
      const down = (event: PointerEvent) => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        if (action === 'mine') {
          this.mining = true;
          this.attackPressed = true;
        } else if (action === 'use') {
          this.using = true;
          this.usePressed = true;
        } else if (action === 'jump') this.touchJump = true;
        else if (action === 'sneak') this.touchSneak = !this.touchSneak;
        else if (action === 'sprint') this.touchSprint = !this.touchSprint;
        else if (action === 'inventory') this.callbacks.toggleInventory();
        else if (action === 'pause') this.callbacks.togglePause();
      };
      const up = () => {
        if (action === 'mine') this.mining = false;
        else if (action === 'use') this.using = false;
        else if (action === 'jump') this.touchJump = false;
      };
      button.addEventListener('pointerdown', down);
      button.addEventListener('pointerup', up);
      button.addEventListener('pointercancel', up);
    }
  }

  private rotate(dx: number, dy: number): void {
    this.yaw -= dx * this.sensitivity;
    this.pitch = clamp(this.pitch - dy * this.sensitivity, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
  }
}
