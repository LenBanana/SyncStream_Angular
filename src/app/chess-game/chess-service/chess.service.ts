import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ChessGame, ChessMove } from '../../Interfaces/Games/chess';
import { hubConnection, SignalRService } from '../../services/signal-r.service';

@Injectable({
  providedIn: 'root'
})
export class ChessService {

  chessPlay: BehaviorSubject<ChessGame> = new BehaviorSubject(null);
  chessMove: BehaviorSubject<ChessMove> = new BehaviorSubject(null);
  chessEnd: BehaviorSubject<boolean> = new BehaviorSubject(null);
  chessReset: BehaviorSubject<boolean> = new BehaviorSubject(null);
  constructor(private signalRService: SignalRService) {
    signalRService.connectionClosed.subscribe(isClosed => {
      if (isClosed===false) {
        this.addChessListener();
        this.addChessMoveListener();
        this.addChessEndListener();
        this.addChessResetListener();
      }
      if (isClosed===true) {
        this.removeChessListener();
        this.removeChessMoveListener();
        this.removeChessEndListener();
        this.removeChessResetListener();
      }
    });
   }

   public NullAllSubs() {
    this.chessPlay.next(null);
    this.chessMove.next(null);
    this.chessEnd.next(null);
    this.chessReset.next(null);
   }

  public addChessListener() {
    hubConnection.on('playchess', (data) => {
      this.chessPlay.next(data);
    })
  }

  public removeChessListener() {
    hubConnection.off('playchess');
    this.chessPlay.next(null);
  }

  public addChessResetListener() {
    hubConnection.on('resetchess', (data) => {
      this.chessReset.next(true);
    })
  }

  public removeChessResetListener() {
    hubConnection.off('resetchess');
    this.chessReset.next(null);
  }

  public addChessEndListener() {
    hubConnection.on('endchess', (data) => {
      this.chessEnd.next(true);
    })
  }

  public removeChessEndListener() {
    hubConnection.off('endchess');
    this.chessEnd.next(null);
  }

  public addChessMoveListener() {
    hubConnection.on('moveChessPiece', (data) => {
      this.chessMove.next(data);
    })
  }

  public removeChessMoveListener() {
    hubConnection.off('moveChessPiece');
    this.chessMove.next(null);
  }


  public moveChessPiece(UniqueId: string, move: ChessMove) {
    hubConnection.invoke('MoveChessPiece', UniqueId, move);
  }
  public playChess(UniqueId: string) {
    hubConnection.invoke('PlayChess', UniqueId);
  }
  public endChess(UniqueId: string) {
    hubConnection.invoke('EndChess', UniqueId);
  }
  public resetChess(UniqueId: string) {
    hubConnection.invoke('ResetChess', UniqueId);
  }
}

export enum ChessColor {
  White,
  Black
}
