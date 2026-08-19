/**
 * The server's answer to a request to join a room.
 *
 * Sent as its numeric value, so these numbers are a wire contract with the server's own UserUpdate.
 */
export enum UserUpdate {
  /** The chosen display name was malformed, or is reserved by a registered account. */
  NameNotAllowed = -4,
  RoomNotExist = -3,
  Banned = -2,
  WrongPassword = -1,
  Success = 1
}
