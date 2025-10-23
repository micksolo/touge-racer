export interface InputSnapshot {
  steer: number;
  throttle: number;
  brake: number;
  handbrake: number;
}

export class InputController {
  private readonly keys = new Set<string>();
  private readonly keydownListener: EventListener;
  private readonly keyupListener: EventListener;
  private readonly element: Window | Document;

  constructor(element?: Window | Document) {
    this.element = element ?? window;
    this.keydownListener = (event) => {
      if (event instanceof KeyboardEvent) {
        this.handleKeyDown(event);
      }
    };
    this.keyupListener = (event) => {
      if (event instanceof KeyboardEvent) {
        this.handleKeyUp(event);
      }
    };
    this.element.addEventListener('keydown', this.keydownListener);
    this.element.addEventListener('keyup', this.keyupListener);
  }

  getSnapshot(): InputSnapshot {
    const left = this.keys.has('ArrowLeft') || this.keys.has('KeyA');
    const right = this.keys.has('ArrowRight') || this.keys.has('KeyD');
    const steer = Number(right) - Number(left);

    const throttle = this.keys.has('ArrowUp') || this.keys.has('KeyW') ? 1 : 0;
    const brake = this.keys.has('Space') ? 1 : this.keys.has('ArrowDown') || this.keys.has('KeyS') ? 1 : 0;
    const handbrake = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 1 : 0;

    return { steer, throttle, brake, handbrake };
  }

  dispose(): void {
    this.element.removeEventListener('keydown', this.keydownListener);
    this.element.removeEventListener('keyup', this.keyupListener);
    this.keys.clear();
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.repeat) {
      return;
    }
    this.keys.add(event.code);
    this.preventIfGameKey(event);
  }

  private handleKeyUp(event: KeyboardEvent): void {
    this.keys.delete(event.code);
    this.preventIfGameKey(event);
  }

  private preventIfGameKey(event: KeyboardEvent): void {
    const codes = new Set([
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'KeyW',
      'KeyA',
      'KeyS',
      'KeyD',
      'Space',
      'ShiftLeft',
      'ShiftRight',
    ]);
    if (codes.has(event.code)) {
      event.preventDefault();
    }
  }
}
