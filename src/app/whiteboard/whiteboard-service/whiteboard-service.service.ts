import { Injectable } from '@angular/core';
import { CanvasWhiteboardUpdate } from 'ng2-canvas-whiteboard';
import { BehaviorSubject } from 'rxjs';
import { Member } from 'src/app/Interfaces/Member';
import { hubConnection, SignalRService } from 'src/app/services/signal-r.service';

@Injectable({
  providedIn: 'root'
})
export class WhiteboardService {
  gallowMember: BehaviorSubject<Member[]> = new BehaviorSubject(null);
  gallowTimer: BehaviorSubject<number> = new BehaviorSubject(null);
  gallowIsDrawing: BehaviorSubject<boolean> = new BehaviorSubject(null);
  whiteboardUpdate: BehaviorSubject<any> = new BehaviorSubject(null);
  whiteboardJoin: BehaviorSubject<any> = new BehaviorSubject(null);
  whiteboardClear: BehaviorSubject<boolean> = new BehaviorSubject(null);
  whiteboardUndo: BehaviorSubject<string> = new BehaviorSubject(null);
  whiteboardRedo: BehaviorSubject<string> = new BehaviorSubject(null);
  
  constructor(private signalRService: SignalRService) {
    signalRService.connectionClosed.subscribe(isClosed => {
      if (isClosed===false) {
        this.addGallowTimerListener();
        this.addGallowUserListener();
        this.addGallowDrawingListener();
        this.addWhiteBoardClearListener();
        this.addWhiteBoardJoinListener();
        this.addWhiteBoardListener();
        this.addWhiteBoardReDoListener();
        this.addWhiteBoardUnDoListener();
      }
      if (isClosed===true) {
        this.removeGallowTimerListener();
        this.removeGallowUserListener();
        this.removeGallowDrawingListener();
        this.removeWhiteBoardClearListener();
        this.removeWhiteBoardJoinListener();
        this.removeWhiteBoardListener();
        this.removeWhiteBoardReDoListener();
        this.removeWhiteBoardUnDoListener();
      }
    });
   }

  public NullAllSubs() {
    this.gallowMember.next(null);
    this.gallowTimer.next(null);
    this.whiteboardJoin.next(null);
    this.whiteboardUpdate.next(null);
    this.whiteboardClear.next(null);
    this.whiteboardUndo.next(null);
    this.whiteboardRedo.next(null);
  }

  public getWhiteBoard(UniqueId: string) {
    hubConnection.invoke('WhiteBoardJoin', UniqueId);
  }

  public NewGallow(UniqueId: string) {
    hubConnection.invoke('NewGallow', UniqueId);
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
      this.gallowMember.next(data);
    });
  }

  public removeGallowUserListener() {
    hubConnection.off('gallowusers');
    this.gallowMember.next(null);
  }

  public addGallowDrawingListener() {
    hubConnection.on('isdrawingupdate', (data) => {
      this.gallowIsDrawing.next(data);
    });
  }

  public removeGallowDrawingListener() {
    hubConnection.off('isdrawingupdate');
    this.gallowIsDrawing.next(null);
  }

  public addGallowTimerListener() {
    hubConnection.on('gallowtimerupdate', (data) => {
      this.gallowTimer.next(data);
    });
  }

  public removeGallowTimerListener() {
    hubConnection.off('gallowtimerupdate');
    this.gallowTimer.next(null);
  }

  public addWhiteBoardJoinListener() {
    hubConnection.on('whiteboardjoin', (data) => {
      this.whiteboardJoin.next(data);
    });
  }

  public removeWhiteBoardJoinListener() {
    hubConnection.off('whiteboardjoin');
    this.whiteboardJoin.next(null);
  }

  public addWhiteBoardListener() {
    hubConnection.on('whiteboardupdate', (data) => {
      this.whiteboardUpdate.next(data);
    });
  }

  public removeWhiteBoardListener() {
    hubConnection.off('whiteboardupdate');
    this.whiteboardUpdate.next(null);
  }

  public addWhiteBoardClearListener() {
    hubConnection.on('whiteboardclear', (data) => {
      this.whiteboardClear.next(data);
    });
  }

  public removeWhiteBoardClearListener() {
    hubConnection.off('whiteboardclear');
    this.whiteboardClear.next(null);
  }

  public addWhiteBoardUnDoListener() {
    hubConnection.on('whiteboardundo', (data) => {
      this.whiteboardUndo.next(data);
    });
  }

  public removeWhiteBoardUnDoListener() {
    hubConnection.off('whiteboardundo');
    this.whiteboardUndo.next(null);
  }

  public addWhiteBoardReDoListener() {
    hubConnection.on('whiteboardredo', (data) => {
      this.whiteboardRedo.next(data);
    });
  }

  public removeWhiteBoardReDoListener() {
    hubConnection.off('whiteboardredo');
    this.whiteboardRedo.next(null);
  }
}
