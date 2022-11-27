import { Member } from "../Member";

export interface ChessGame {
  lightPlayer: Member;
  lightPlayerAi: boolean;
  darkPlayer: Member;
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
