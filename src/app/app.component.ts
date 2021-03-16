import { Component, OnInit } from '@angular/core';
import { Dialog } from './Interfaces/Dialog';
import { DialogService } from './text-dialog/text-dialog-service/dialog-service.service';
declare var $:any

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit {
  title = 'SyncStream';
  serverDialog: Dialog = { id: 'server', header: 'Haha', question: '', answer1: 'Ok', answer2: '', yes: null, no: null }

  constructor(public dialogService: DialogService) {}

  ngOnInit()  {   
    this.dialogService.newDialog.subscribe(dialog => {
      if (dialog == null) {
        return;
      }
      this.serverDialog.header = dialog.header;
      this.serverDialog.question = dialog.question;
      this.serverDialog.answer1 = dialog.answer1;
      this.serverDialog.answer2 = dialog.answer2;
      $('#dialogModal-server').modal('show');     
    });
  }
}
