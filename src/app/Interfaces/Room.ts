import {Server} from "./server";

export interface Room {
  uniqueId: string,
  password: string,
  deletable: boolean,
  isPrivileged: boolean,
  name: string,
  server: Server
}
