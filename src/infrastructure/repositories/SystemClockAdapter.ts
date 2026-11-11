import { ClockPort } from '../../application/ports/ClockPort.ts';

export class SystemClockAdapter implements ClockPort {
  public nowMs(): number {
    return Date.now();
  }

  public random(): number {
    return Math.random();
  }
}
