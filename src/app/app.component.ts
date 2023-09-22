import { Component, OnDestroy, OnInit } from '@angular/core';
import { AlertType, Dialog } from './Interfaces/Dialog';
import { DialogService } from './text-dialog/text-dialog-service/dialog-service.service';
import {setVolume} from "./Interfaces/Sounds";
declare var $:any

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'DreckTube';
  serverDialog: Dialog = { id: 'server', header: 'Haha', question: '', answer1: 'Ok', answer2: '', yes: null, no: null, alertType: AlertType.Success }
  dialogUpdate;

  constructor(public dialogService: DialogService) {}

  ngOnInit()  {
    setVolume(0.25);
    this.dialogUpdate = this.dialogService.newDialog.subscribe(dialog => {
      if (dialog == null) {
        return;
      }
      this.serverDialog.header = dialog.header;
      this.serverDialog.question = dialog.question;
      this.serverDialog.answer1 = dialog.answer1;
      this.serverDialog.answer2 = dialog.answer2;
      this.serverDialog.alertType = dialog.alertType;
      $('#dialogModal-server').modal('show');
    });
    $(document).on('show.bs.modal', '.modal', function () {
      var zIndex = 1040 + (10 * $('.modal:visible').length);
      $(this).css('z-index', zIndex);
      setTimeout(function() {
          $('.modal-backdrop').not('.modal-stack').css('z-index', zIndex - 1).addClass('modal-stack');
      }, 0);
  });
  }

  ngOnDestroy() {
    this.dialogUpdate.unsubscribe();
  }
}
