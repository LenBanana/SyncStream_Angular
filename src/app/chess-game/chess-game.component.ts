import {
  Component,
  Input,
  OnDestroy,
  OnInit,
  ViewChild
} from '@angular/core';
import {
  NgxChessBoardService,
  NgxChessBoardView,
  PieceIconInput
} from 'ngx-chess-board';
import {
  ChessGame,
  ChessMove
} from '../Interfaces/Games/chess';
import {
  ChessService
} from './chess-service/chess.service';
declare var $: any;

@Component({
  selector: 'app-chess-game',
  templateUrl: './chess-game.component.html',
  styleUrls: ['./chess-game.component.scss']
})
export class ChessGameComponent implements OnInit, OnDestroy {

  constructor(private chessService: ChessService, private ngxChessBoardService: NgxChessBoardService) {}
  @Input() UniqueId: string;
  @Input() Username: string;
  @ViewChild('chessboard', {
    static: false
  }) board: NgxChessBoardView;
  maxSize = 1000;
  ignoreNextMove = false;
  gameRunning = false;
  chessGame: ChessGame;
  chessPlay;
  chessMove;
  chessReset;
  chessEnd;
  icons: PieceIconInput = {
    blackBishopUrl: '/assets/chess/bB.svg',
    blackKingUrl: '/assets/chess/bK.svg',
    blackKnightUrl: '/assets/chess/bN.svg',
    blackPawnUrl: '/assets/chess/bP.svg',
    blackQueenUrl: '/assets/chess/bQ.svg',
    blackRookUrl: '/assets/chess/bR.svg',
    whiteBishopUrl: '/assets/chess/wB.svg',
    whiteKingUrl: '/assets/chess/wK.svg',
    whiteKnightUrl: '/assets/chess/wN.svg',
    whitePawnUrl: '/assets/chess/wP.svg',
    whiteQueenUrl: '/assets/chess/wQ.svg',
    whiteRookUrl: '/assets/chess/wR.svg'
  };
  chessAI = require('chess-ai-kong');
  currentMoves: string[] = [];

  ngOnInit(): void {
    this.chessAI.setOptions({
      depth: 4,
      monitor: false,
      strategy: 'basic',
      timeout: 10000
    });
    this.maxSize = window.innerHeight - 10;
    window.addEventListener('resize', (event) => {
      this.maxSize = window.innerHeight - 10;
    }, true);
    this.chessPlay = this.chessService.chessPlay.subscribe(game => {
      if (game == null) {
        return;
      }
      this.chessGame = game;
      this.gameRunning = true;
      setTimeout(() => {
        this.board.reset();
        if (game.gameFEN != null && game.gameFEN.length > 0) {
          this.board.setFEN(game.gameFEN);
        }
        if (game.darkPlayer.username == this.Username) {
          this.board.reverse();
        }
        if (game.darkPlayerAi == true && game.lightPlayerAi == true) {
          //this.AiPlay();
        }
      }, 100);
    });
    this.chessMove = this.chessService.chessMove.subscribe(move => {
      if (move == null) {
        return;
      }
      if (this.chessGame.darkPlayerAi == true && this.chessGame.lightPlayerAi == true) {
        if (this.Username == this.chessGame.lightPlayer.username) {
          return;
        }
      }
      this.ignoreNextMove = true;
      setTimeout(() => {
        this.board.move(move.move);
      }, 100);
    });
    this.chessEnd = this.chessService.chessEnd.subscribe(end => {
      if (end == null) {
        return;
      }
      this.gameRunning = false;
      this.board.reset();
    });
    this.chessReset = this.chessService.chessReset.subscribe(reset => {
      if (reset == null) {
        return;
      }
      this.board.reset();
    });
  }

  AiPlay() {
    if (this.Username != this.chessGame.lightPlayer.username || this.gameRunning == false) {
      return;
    }
    setTimeout(() => {
      var position = this.chessAI.play(this.currentMoves);
      this.currentMoves.push(position);
      var pgn = this.currentMoves.join(' ');
      this.board.setPGN(pgn);
      var history = this.board.getMoveHistory().map(x => x.move);
      var move: ChessMove = {
        move: history[history.length-1],
        FEN: this.board.getFEN(),
        check: false,
        checkmate: false,
        color: 'Ai'
      }
      this.chessService.moveChessPiece(this.UniqueId, move);
      if (this.chessGame.darkPlayerAi == true && this.chessGame.lightPlayerAi == true) {
        this.AiPlay();
        return;
      }
    }, 250);
  }

  ngOnDestroy() {
    this.chessPlay.unsubscribe();
    this.chessReset.unsubscribe();
    this.chessMove.unsubscribe();
    this.chessEnd.unsubscribe();
  }

  moveChange(event) {
    if (this.ignoreNextMove) {
      this.ignoreNextMove = false;
      return;
    }
    if (event.checkmate == true) {
      $('#dialogModal-endchess').modal('show');
    }
    var move: ChessMove = {
      move: event.move,
      FEN: this.board.getFEN(),
      check: event.check,
      checkmate: event.checkmate,
      color: event.color
    }
    this.chessService.moveChessPiece(this.UniqueId, move)
  }

}
