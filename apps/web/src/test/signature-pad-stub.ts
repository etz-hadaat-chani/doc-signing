import { vi } from 'vitest';

/**
 * A stand-in for signature_pad in jsdom (no canvas there): `vi.mock('signature_pad', () =>
 * import('…/test/signature-pad-stub'))`. `padStub.pads` are the pads made; `draw(pad)` ends a
 * stroke as the mouse would, and the pad then gives `padStub.png`.
 */
export const padStub = {
  pads: [] as StubPad[],
  png: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
};

export class StubPad {
  readonly canvas: HTMLCanvasElement;
  private readonly listeners = new Map<string, () => void>();
  private empty = true;
  readonly fromDataURL = vi.fn((...args: [url: string, options?: object]) => {
    void args;
    this.empty = false;
    return Promise.resolve();
  });
  readonly clear = vi.fn(() => {
    this.empty = true;
  });

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    padStub.pads.push(this);
  }

  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type: string) {
    this.listeners.delete(type);
  }

  off() {}

  isEmpty() {
    return this.empty;
  }

  toDataURL() {
    return padStub.png;
  }

  /** A stroke drawn and ended. */
  stroke() {
    this.empty = false;
    this.listeners.get('endStroke')?.();
  }
}

export default StubPad;
