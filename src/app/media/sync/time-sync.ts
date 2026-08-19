/**
 * A dated playback position, as the hub sends it.
 *
 * Mirrors the server's TimeSyncDto. The payload used to be a bare number, which a viewer could only compare
 * against its own present, with no way to know how long ago it had been sampled.
 */
export interface TimeSync {
  /** Where the host was, in seconds. */
  mediaTime: number;

  /** How long ago that was, in milliseconds. Zero when the host is reporting right now. */
  ageMs: number;

  /** Whether playback was running. A paused position must not be extrapolated. */
  isPlaying: boolean;
}
