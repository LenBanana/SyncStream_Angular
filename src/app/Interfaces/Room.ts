import { Server } from "./server";

export interface Room {
    uniqueId: string,
    password: string,
    gallowWord: string,
    playingGallows: boolean,
    name: string,
    server: Server
  }
  