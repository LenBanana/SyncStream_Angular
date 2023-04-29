import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { AlertType, Dialog } from '../../Interfaces/Dialog';
import { hubConnection, SignalRService } from '../../services/signal-r.service';

@Injectable({
  providedIn: 'root'
})
export class DialogService {

  newDialog: BehaviorSubject<Dialog> = new BehaviorSubject(null);
  newPreFill: BehaviorSubject<string> = new BehaviorSubject(null);
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

  public PushDefaultDialog(text: string, header: string, type: AlertType) {
    const dialog: Dialog = {
      id: "media-editor-perm",
      header: header,
      question: text,
      answer1: "Ok",
      answer2: null,
      yes: null,
      no: null,
      alertType: type
    };
    this.newDialog.next(dialog);
  }

  public PushPermissionDialog() {
    this.PushDefaultDialog("Permission to content denied.", "Permission error", AlertType.Danger);
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
