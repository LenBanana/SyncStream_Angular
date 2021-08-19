import { Injectable } from '@angular/core';
import { CanvasWhiteboardUpdate } from 'ng2-canvas-whiteboard';
import { BehaviorSubject } from 'rxjs';
import { Member } from 'src/app/Interfaces/Member';
import { hubConnection } from 'src/app/services/signal-r.service';

@Injectable({
  providedIn: 'root'
})
export class WhiteboardService {

  constructor() { }
  gallowUser: BehaviorSubject<Member[]> = new BehaviorSubject(null);
  gallowTimer: BehaviorSubject<number> = new BehaviorSubject(null);
  whiteboardUpdate: BehaviorSubject<any> = new BehaviorSubject(null);
  whiteboardJoin: BehaviorSubject<any> = new BehaviorSubject(null);
  whiteboardClear: BehaviorSubject<boolean> = new BehaviorSubject(null);
  whiteboardUndo: BehaviorSubject<string> = new BehaviorSubject(null);
  whiteboardRedo: BehaviorSubject<string> = new BehaviorSubject(null);

  public getWhiteBoard(UniqueId: string) {
    hubConnection.invoke('WhiteBoardJoin', UniqueId);
  }

  public updateWhiteBoard(update, UniqueId: string) {
    hubConnection.invoke('WhiteBoardUpdate', update, UniqueId);
  }

  public clearWhiteBoard(UniqueId: string) {
    hubConnection.invoke('WhiteBoardClear', UniqueId);
  }

  public undoWhiteBoard(UniqueId: string, uuid: string) {
    hubConnection.invoke('WhiteBoardUndo', UniqueId, uuid);
  }

  public redoWhiteBoard(UniqueId: string, uuid: string) {
    hubConnection.invoke('WhiteBoardUndo', UniqueId, uuid);
  }

  public addGallowUserListener() {
    hubConnection.on('gallowusers', (data) => {
      this.gallowUser.next(data);
    });
  }

  public removeGallowUserListener() {
    hubConnection.off('gallowusers', (data) => {});
  }

  public addGallowTimerListener() {
    hubConnection.on('gallowtimerupdate', (data) => {
      this.gallowTimer.next(data);
    });
  }

  public removeGallowTimerListener() {
    hubConnection.off('gallowtimerupdate', (data) => {});
  }

  public addWhiteBoardJoinListener() {
    hubConnection.on('whiteboardjoin', (data) => {
      this.whiteboardJoin.next(data);
    });
  }

  public removeWhiteBoardJoinListener() {
    hubConnection.off('whiteboardjoin', (data) => {});
  }

  public addWhiteBoardListener() {
    hubConnection.on('whiteboardupdate', (data) => {
      this.whiteboardUpdate.next(data);
    });
  }

  public removeWhiteBoardListener() {
    hubConnection.off('whiteboardupdate', (data) => {});
  }

  public addWhiteBoardClearListener() {
    hubConnection.on('whiteboardclear', (data) => {
      this.whiteboardClear.next(data);
    });
  }

  public removeWhiteBoardClearListener() {
    hubConnection.off('whiteboardclear', (data) => {});
  }

  public addWhiteBoardUnDoListener() {
    hubConnection.on('whiteboardundo', (data) => {
      this.whiteboardUndo.next(data);
    });
  }

  public removeWhiteBoardUnDoListener() {
    hubConnection.off('whiteboardundo', (data) => {});
  }

  public addWhiteBoardReDoListener() {
    hubConnection.on('whiteboardredo', (data) => {
      this.whiteboardRedo.next(data);
    });
  }

  public removeWhiteBoardReDoListener() {
    hubConnection.off('whiteboardredo', (data) => {});
  }
}
