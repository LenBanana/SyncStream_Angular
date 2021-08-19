import { Server } from "./server";

export interface Room {
    uniqueId: string,
    password: string,
    name: string,
    server: Server
  }
  