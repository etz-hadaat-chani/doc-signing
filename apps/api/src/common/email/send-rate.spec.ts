import { describe, expect, it } from 'vitest';
import { SendRate } from './send-rate.js';

/** A clock that only moves when the limiter waits, so the waits are exact. */
function fakeClock() {
  let time = 1_000;
  const waits: number[] = [];
  return {
    waits,
    now: () => time,
    wait: (ms: number) => {
      waits.push(ms);
      time += ms;
      return Promise.resolve();
    },
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe('SendRate', () => {
  it('lets the first send go at once and spaces the next ones 1000 / rate ms apart', async () => {
    const clock = fakeClock();
    const rate = new SendRate(10, clock.now, clock.wait);
    for (let i = 0; i < 4; i += 1) await rate.take();
    expect(clock.waits).toEqual([100, 100, 100]);
  });

  it('does not wait when the sends are already slower than the rate', async () => {
    const clock = fakeClock();
    const rate = new SendRate(4, clock.now, clock.wait);
    await rate.take();
    clock.advance(300);
    await rate.take();
    expect(clock.waits).toEqual([]);
  });

  it('queues sends started at the same moment one after the other', async () => {
    const clock = fakeClock();
    const rate = new SendRate(2, () => 1_000, clock.wait);
    await Promise.all([rate.take(), rate.take(), rate.take()]);
    expect(clock.waits).toEqual([500, 1000]);
  });
});
