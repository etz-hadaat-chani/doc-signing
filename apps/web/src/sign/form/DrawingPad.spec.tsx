import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { padStub } from '../../test/signature-pad-stub';
import { DrawingPad } from './DrawingPad';

vi.mock('signature_pad', () => import('../../test/signature-pad-stub'));

const PNG = 'data:image/png;base64,c2F2ZWQ=';
const box = { width: 400, height: 160 };

/** jsdom has no layout: the canvas's size on screen and the pixel density, set by the test. */
function stubLayout() {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(() => box.width);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => box.height);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    scale: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
}

beforeEach(() => {
  padStub.pads.length = 0;
  box.width = 400;
  box.height = 160;
  vi.stubGlobal('devicePixelRatio', 1);
  stubLayout();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DrawingPad', () => {
  it('draws the saved drawing when it opens, at the screen size', () => {
    const { container } = render(
      <DrawingPad
        value={PNG}
        onDraw={vi.fn()}
        label="ציור"
        height={160}
        maxWidth={400}
        clearSignal={0}
      />,
    );
    const canvas = container.querySelector('canvas');
    const pad = padStub.pads[0];
    expect(canvas?.width).toBe(400);
    expect(canvas?.height).toBe(160);
    expect(pad?.fromDataURL).toHaveBeenCalledWith(PNG, { ratio: 1, width: 400, height: 160 });
  });

  it('a resize, a zoom or a new pixel density: the canvas is resized and the drawing drawn again', () => {
    const { container } = render(
      <DrawingPad
        value={PNG}
        onDraw={vi.fn()}
        label="ציור"
        height={160}
        maxWidth={400}
        clearSignal={0}
      />,
    );
    const canvas = container.querySelector('canvas');
    const pad = padStub.pads[0];
    pad?.fromDataURL.mockClear();
    pad?.clear.mockClear();

    box.width = 300;
    vi.stubGlobal('devicePixelRatio', 2);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(canvas?.width).toBe(600);
    expect(canvas?.height).toBe(320);
    expect(pad?.clear).toHaveBeenCalledTimes(1);
    expect(pad?.fromDataURL).toHaveBeenCalledWith(PNG, { ratio: 2, width: 300, height: 160 });

    // The same size again: nothing is redrawn.
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(pad?.fromDataURL).toHaveBeenCalledTimes(1);
  });

  it('a stroke gives the whole drawing as PNG; an empty pad draws nothing back', () => {
    const onDraw = vi.fn();
    render(
      <DrawingPad
        value=""
        onDraw={onDraw}
        label="ציור"
        height={160}
        maxWidth={400}
        clearSignal={0}
      />,
    );
    const pad = padStub.pads[0];
    expect(pad?.fromDataURL).not.toHaveBeenCalled();
    act(() => pad?.stroke());
    expect(onDraw).toHaveBeenCalledWith(padStub.png);
  });
});
