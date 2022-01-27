import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Dialog } from 'src/app/Interfaces/Dialog';
import { hubConnection, SignalRService } from 'src/app/services/signal-r.service';

@Injectable({
  providedIn: 'root'
})
export class DialogService {

  newDialog: BehaviorSubject<Dialog> = new BehaviorSubject(null);
  constructor(private signalRService: SignalRService) {
    signalRService.connectionClosed.subscribe(isClosed => {
      if (isClosed===false) {
        this.addDialogListener();
      }
      if (isClosed===true) {
        this.removeDialogListener();
      }
    });
   }
  
  public addDialogListener() {
    hubConnection.on('dialog', (data) => {
      this.newDialog.next(data);
    });
  }

  public removeDialogListener() {
    hubConnection.off('dialog');
    this.newDialog.next(null);
  }
}
