import { RoomMemberSummary } from "../Room";

export interface ChessGame {
  lightPlayer: RoomMemberSummary;
  lightPlayerAi: boolean;
  darkPlayer: RoomMemberSummary;
  darkPlayerAi: boolean;
  uniqueId: string;
  gameFEN: string;
}

export interface ChessMove {
  move: string;
  FEN: string;
  check: boolean;
  checkmate: boolean;
  color: string;
}
