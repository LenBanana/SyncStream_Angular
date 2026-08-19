/**
 * Which player a room is showing.
 *
 * Mirrors the server's PlayerType, which is sent as its numeric value over the hub, so the order of the members
 * up to and including FileShare is a wire contract and cannot be rearranged.
 *
 * Lived in the superseded player component until that was deleted, which meant importing a whole player to name
 * a value.
 */
export enum PlayerType {
  Nothing,
  YouTube,
  Twitch,
  Vimeo,
  External,
  Live,
  WhiteBoard,
  Blackjack,
  Chess,
  WebRtc,
  /** A room member is streaming a local video file to the room via WebRTC/SFU. */
  FileShare,
  /**
   * A room member is streaming a local video file to the room via RTMP/HLS.
   *
   * Set only in the browser, from the RTMP file share events, and never received from the server: the server's
   * enum ends at FileShare. If a member is ever added there it takes this value, so add it here too rather than
   * leaving the two to disagree silently.
   */
  RtmpFileShare
}
