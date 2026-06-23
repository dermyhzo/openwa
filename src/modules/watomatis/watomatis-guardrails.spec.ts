import { WatomatisRuntime } from './watomatis-runtime.service';
import { NotFoundException } from '@nestjs/common';

// ---------------------------------------------------------------------------
// withinBusinessHours — tested by mocking Date.prototype.toLocaleTimeString
// ---------------------------------------------------------------------------

/** Helper: create a minimal WatomatisRuntime without real dependencies. */
function makeRuntime(): WatomatisRuntime {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new (WatomatisRuntime as any)(null, null, null, null, null) as WatomatisRuntime;
}

describe('WatomatisRuntime.withinBusinessHours', () => {
  let runtime: WatomatisRuntime;
  let originalToLocaleTimeString: typeof Date.prototype.toLocaleTimeString;

  beforeEach(() => {
    runtime = makeRuntime();
    originalToLocaleTimeString = Date.prototype.toLocaleTimeString;
  });

  afterEach(() => {
    Date.prototype.toLocaleTimeString = originalToLocaleTimeString;
  });

  function mockJktTime(hhmm: string) {
    Date.prototype.toLocaleTimeString = function (_locale, opts) {
      if (opts && (opts as Record<string, unknown>).timeZone === 'Asia/Jakarta') {
        return hhmm;
      }
      return originalToLocaleTimeString.call(this, _locale, opts);
    };
  }

  it('returns true when current time is inside business hours', () => {
    mockJktTime('10:00');
    expect(runtime.withinBusinessHours({ start: '08:00', end: '17:00' })).toBe(true);
  });

  it('returns true at the exact start boundary', () => {
    mockJktTime('08:00');
    expect(runtime.withinBusinessHours({ start: '08:00', end: '17:00' })).toBe(true);
  });

  it('returns true at the exact end boundary', () => {
    mockJktTime('17:00');
    expect(runtime.withinBusinessHours({ start: '08:00', end: '17:00' })).toBe(true);
  });

  it('returns false when current time is before business hours', () => {
    mockJktTime('07:59');
    expect(runtime.withinBusinessHours({ start: '08:00', end: '17:00' })).toBe(false);
  });

  it('returns false when current time is after business hours', () => {
    mockJktTime('17:01');
    expect(runtime.withinBusinessHours({ start: '08:00', end: '17:00' })).toBe(false);
  });

  it('returns false at midnight for daytime hours', () => {
    mockJktTime('00:00');
    expect(runtime.withinBusinessHours({ start: '08:00', end: '17:00' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Readiness endpoint logic — tested as pure functions to avoid NestJS DI
// ---------------------------------------------------------------------------

const READINESS_MIN_RECORDINGS = 20;

function computeReadiness(recordings: number, qna: number, mode: 'supervised' | 'auto' | 'off') {
  const ready = recordings >= READINESS_MIN_RECORDINGS;
  const suggestFullAuto = mode === 'supervised' && ready;
  const reason = ready
    ? `Agent sudah belajar dari ${recordings} percakapan — siap dicoba full-auto.`
    : `Masih belajar: ${recordings}/${READINESS_MIN_RECORDINGS} percakapan terekam.`;
  return { recordings, qna, ready, suggestFullAuto, reason };
}

describe('Readiness logic', () => {
  it('is not ready when recordings < 20', () => {
    const r = computeReadiness(10, 5, 'supervised');
    expect(r.ready).toBe(false);
    expect(r.suggestFullAuto).toBe(false);
    expect(r.reason).toBe('Masih belajar: 10/20 percakapan terekam.');
  });

  it('is ready when recordings >= 20', () => {
    const r = computeReadiness(20, 15, 'supervised');
    expect(r.ready).toBe(true);
    expect(r.suggestFullAuto).toBe(true);
    expect(r.reason).toBe('Agent sudah belajar dari 20 percakapan — siap dicoba full-auto.');
  });

  it('does not suggest full-auto when already in auto mode', () => {
    const r = computeReadiness(25, 15, 'auto');
    expect(r.ready).toBe(true);
    expect(r.suggestFullAuto).toBe(false);
  });

  it('does not suggest full-auto when mode is off', () => {
    const r = computeReadiness(30, 10, 'off');
    expect(r.ready).toBe(true);
    expect(r.suggestFullAuto).toBe(false);
  });

  it('passes through recordings and qna counts', () => {
    const r = computeReadiness(5, 42, 'supervised');
    expect(r.recordings).toBe(5);
    expect(r.qna).toBe(42);
  });
});
