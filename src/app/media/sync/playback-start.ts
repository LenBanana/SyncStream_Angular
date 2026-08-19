/**
 * Starts playback without letting the browser's autoplay policy break the page.
 *
 * A viewer is told to play by the room, so the call is not the result of a gesture on their device. Mobile
 * browsers refuse that and reject the promise, and an unhandled rejection is a fatal zone error in Angular.
 * Worse, the player stays paused while the room believes it is playing, so the sync logic goes on correcting
 * a video that is not moving and the viewer drifts further behind with every report.
 *
 * @returns whether playback actually began.
 */
export async function startPlayback(play: () => unknown): Promise<boolean> {
  try {
    await Promise.resolve(play());
    return true;
  } catch {
    // Refused, almost always for want of a user gesture. The person has to tap the player themselves; there
    // is nothing here that can grant permission.
    console.info('Playback was not allowed to start without a gesture on this device');
    return false;
  }
}
