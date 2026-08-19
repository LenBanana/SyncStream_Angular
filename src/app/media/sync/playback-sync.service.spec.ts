import { BehaviorSubject } from 'rxjs';
import { DriftLimits } from './playback-drift';
import { PlaybackSyncService } from './playback-sync.service';
import { PlaybackTarget } from './playback-target';
import { TimeSync } from './time-sync';

class FakeTarget implements PlaybackTarget {
  position = 100;
  rate = 1;
  seeks: number[] = [];
  fineRate = true;
  isBusy = false;
  hasBuffer = true;
  isPaused = false;
  length: number | null = null;

  currentTime(): number | null { return this.position; }
  seekTo(seconds: number): void { this.seeks.push(seconds); this.position = seconds; }
  setRate(rate: number): void { this.rate = rate; }
  currentRate(): number { return this.rate; }
  canNudgeRate(): boolean { return this.fineRate; }
  busy(): boolean { return this.isBusy; }
  buffered(): boolean { return this.hasBuffer; }
  paused(): boolean { return this.isPaused; }
  duration(): number | null { return this.length; }
}

function sync(mediaTime: number, ageMs = 0, isPlaying = true): TimeSync {
  return { mediaTime, ageMs, isPlaying };
}

describe('PlaybackSyncService', () => {
  let pings: BehaviorSubject<number>;
  let service: PlaybackSyncService;
  let target: FakeTarget;

  beforeEach(() => {
    pings = new BehaviorSubject<number>(null);
    service = new PlaybackSyncService({ pingStream: pings } as any);
    target = new FakeTarget();
  });

  it('takes one-way latency as half the smallest recent round trip', () => {
    // The minimum rather than the newest, because the least-queued sample is closest to real transit time.
    // The old code used the newest sample and added the whole round trip as if it were one-way.
    pings.next(0.4);
    pings.next(0.1);
    pings.next(0.3);

    expect(service.oneWayLatencySeconds).toBeCloseTo(0.05, 5);
  });

  it('assumes no latency until it has measured any', () => {
    expect(service.oneWayLatencySeconds).toBe(0);
  });

  it('nudges the rate for small drift instead of seeking', () => {
    // The whole point: a seek on a phone re-buffers, which creates more drift, which triggers another seek.
    target.position = 99.6;
    service.apply(target, sync(100), 1000);

    expect(target.seeks).toEqual([]);
    expect(target.rate).toBeGreaterThan(1);
  });

  it('returns the rate to normal once back in step', () => {
    target.position = 99.6;
    service.apply(target, sync(100), 1000);
    expect(target.rate).not.toBe(1);

    target.position = 100;
    service.apply(target, sync(100), 1100);
    expect(target.rate).toBe(1);
  });

  it('seeks for a large gap and then stays quiet', () => {
    target.position = 50;
    service.apply(target, sync(100), 1000);
    expect(target.seeks).toEqual([100]);

    // Still out of step immediately afterwards, because a real seek takes time to settle. Correcting again
    // here is what turned one seek into a cascade. The gap is seek-worthy but small enough to be drift, which
    // is what the quiet period is for.
    target.position = 98.5;
    service.apply(target, sync(100), 1000 + DriftLimits.seekCooldownMs - 1);
    expect(target.seeks).toEqual([100]);

    // Once the quiet period is over it may act again.
    target.position = 98.5;
    service.apply(target, sync(100), 1000 + DriftLimits.seekCooldownMs + 1);
    expect(target.seeks.length).toBe(2);
  });

  it('returns to normal speed before seeking', () => {
    // Carrying a rate adjustment across a jump would immediately push the viewer back out of step.
    target.position = 99.6;
    service.apply(target, sync(100), 1000);
    expect(target.rate).toBeGreaterThan(1);

    target.position = 50;
    service.apply(target, sync(100), 5000);
    expect(target.rate).toBe(1);
  });

  it('adds the report age so a stale position is not treated as current', () => {
    pings.next(0);
    target.position = 100;

    // The host was at 100 half a second ago and is playing, so the room is at 100.5 now.
    service.apply(target, sync(100, 500), 1000);

    expect(target.rate).toBeGreaterThan(1);
  });

  it('does not extrapolate a paused position', () => {
    target.position = 100;
    service.apply(target, sync(100, 5000, false), 1000);

    expect(target.seeks).toEqual([]);
    expect(target.rate).toBe(1);
  });

  it('does nothing when the position cannot be read', () => {
    spyOn(target, 'currentTime').and.returnValue(null);
    service.apply(target, sync(100), 1000);

    expect(target.seeks).toEqual([]);
  });

  it('nudges a freshly created player even after nudging the previous one', () => {
    // The players are recreated when the source or player type changes; this service lives for the session.
    // Remembering the rate it last wrote meant the new player, which starts at 1, was left there because the
    // service believed it had already been nudged.
    target.position = 99.6;
    service.apply(target, sync(100), 1000);
    const nudged = target.rate;
    expect(nudged).toBeGreaterThan(1);

    const replacement = new FakeTarget();
    replacement.position = 99.6;
    service.apply(replacement, sync(100), 2000);

    expect(replacement.rate).toBeCloseTo(nudged, 5);
  });

  it('keeps an extrapolated target inside the video', () => {
    // Near the end, the age plus the latency can push the target past the last frame. Seeking there raises
    // 'ended', which advances the playlist for this one viewer while everyone else still has a second to go.
    target.length = 100;
    target.position = 90;
    service.apply(target, sync(99.8, 900), 1000);

    expect(target.seeks.length).toBe(1);
    expect(target.seeks[0]).toBeLessThan(100);
  });

  it('never seeks to a negative position', () => {
    target.position = 50;
    service.apply(target, sync(0.1, 0, false), 1000);

    expect(target.seeks.every(at => at >= 0)).toBe(true);
  });

  it('holds a large gap during the quiet period too', () => {
    // Tempting to treat a large gap as a host scrub and correct at once, but a player that stalled and
    // recovered looks exactly the same from the position alone, and seeking straight away is what makes it
    // stall again. The scrub is honoured when the period lapses instead.
    target.position = 50;
    service.apply(target, sync(100), 1000);
    expect(target.seeks.length).toBe(1);

    target.position = 40;
    service.apply(target, sync(100), 1100);

    expect(target.seeks.length).toBe(1);
  });

  it('backs off while a player keeps needing to be jumped', () => {
    // A connection that simply cannot keep up would otherwise be seeked once per quiet period for the whole
    // video. Each correction in a run doubles the wait that follows it, so it degrades to an occasional
    // resync instead of jumping every couple of seconds forever.
    let now = 1000;
    const stillFarBehind = () => {
      target.position = 10;
      service.apply(target, sync(1000), now);
    };

    stillFarBehind();
    expect(target.seeks.length).toBe(1);

    // The first wait is the plain period.
    now += DriftLimits.seekCooldownMs + 1;
    stillFarBehind();
    expect(target.seeks.length).toBe(2);

    // The second correction in the run doubled it, so the same wait is no longer enough.
    now += DriftLimits.seekCooldownMs + 1;
    stillFarBehind();
    expect(target.seeks.length).toBe(2);

    now += DriftLimits.seekCooldownMs;
    stillFarBehind();
    expect(target.seeks.length).toBe(3);
  });

  it('stops backing off once the player is keeping up again', () => {
    let now = 1000;
    target.position = 10;
    service.apply(target, sync(1000), now);
    expect(target.seeks.length).toBe(1);

    // In step: this is the evidence that the run is over.
    now += DriftLimits.seekCooldownMs + 1;
    target.position = 1000;
    service.apply(target, sync(1000), now);

    // So the next correction waits one plain period rather than a doubled one.
    now += 1;
    target.position = 10;
    service.apply(target, sync(1000), now);
    expect(target.seeks.length).toBe(2);

    now += DriftLimits.seekCooldownMs + 1;
    target.position = 10;
    service.apply(target, sync(1000), now);
    expect(target.seeks.length).toBe(3);
  });

  it('does not count a hold it was forced into as the player keeping up', () => {
    // A hold returned because the player was mid-seek says nothing about whether it is in step, so it must not
    // clear the backoff the way an in-step report does.
    let now = 1000;
    target.position = 10;
    service.apply(target, sync(1000), now);
    expect(target.seeks.length).toBe(1);

    // Mid-seek, so no assessment was made.
    now += DriftLimits.seekCooldownMs + 1;
    target.isBusy = true;
    target.position = 10;
    service.apply(target, sync(1000), now);
    expect(target.seeks.length).toBe(1);

    target.isBusy = false;
    now += 1;
    target.position = 10;
    service.apply(target, sync(1000), now);
    expect(target.seeks.length).toBe(2);

    // Doubled, because the run was never broken. Had the busy hold cleared it, this would seek again.
    now += DriftLimits.seekCooldownMs + 1;
    target.position = 10;
    service.apply(target, sync(1000), now);
    expect(target.seeks.length).toBe(2);
  });

  it('takes only real round trips as samples', () => {
    // The estimate is a minimum, so one bogus low value would set the latency for the rest of the session.
    // pingStream carries whatever the hub listener publishes and starts before anything has been measured.
    pings.next(null);
    pings.next(0);
    pings.next(-1);
    expect(service.oneWayLatencySeconds).toBe(0);

    pings.next(0.06);
    expect(service.oneWayLatencySeconds).toBeCloseTo(0.03, 5);
  });

  it('forgets its seek history when the source changes', () => {
    target.position = 50;
    service.apply(target, sync(100), 1000);
    expect(target.seeks.length).toBe(1);

    // A new video is a new timeline, so the quiet period from the old one must not suppress the first
    // correction on the new one.
    service.reset();
    target.position = 10;
    service.apply(target, sync(100), 1001);

    expect(target.seeks.length).toBe(2);
  });
});
