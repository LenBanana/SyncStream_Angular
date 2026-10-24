/** SFU room ids, as the server's SfuRoomId builds them. Each belongs to exactly one chat room. */

/** The room's stage: a broadcast to everyone, or a file share. */
export function stageRoomId(roomId: string): string {
  return `stage:${roomId}`;
}

/** One member's opt-in live stream, watched in the popout. */
export function liveRoomId(roomId: string, streamerId: string): string {
  return `live:${roomId}:${streamerId}`;
}

/** The room's voice and video call. */
export function voiceRoomId(roomId: string): string {
  return `voice:${roomId}`;
}
