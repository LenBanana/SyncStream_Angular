/**
 * What the server sends for the lobby (`getrooms`). Deliberately does not carry the room
 * password, member connection ids, chat history or private messages: the previous payload was the
 * live server object and broadcast all of it to every connected client.
 */
export interface RoomSummary {
  uniqueId: string,
  name: string,
  isPrivileged: boolean,
  deletable: boolean,
  /** Whether a password is required. The password itself never reaches a client. */
  hasPassword: boolean,
  isplaying: boolean,
  title: string,
  currenttime: number,
  members: RoomMemberSummary[],
  playlist: RoomPlaylistEntry[]
}

export interface RoomMemberSummary {
  username: string,
  ishost: boolean
}

export interface RoomPlaylistEntry {
  title: string,
  url: string
}

/** What the client sends to create a room. The server owns everything else about it. */
export interface CreateRoomRequest {
  uniqueId: string,
  name: string,
  password: string,
  deletable: boolean
}
