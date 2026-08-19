import {Component, ElementRef, OnDestroy, OnInit, Renderer2, ViewChild} from '@angular/core';
import {AlertType, Dialog} from './Interfaces/Dialog';
import {DialogService} from './text-dialog/text-dialog-service/dialog-service.service';
import {setVolume} from "./Interfaces/Sounds";
import {AppService} from "./app.service";

declare var $: any

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'DreckTube';
  serverDialog: Dialog = {
    id: 'server',
    header: 'Haha',
    question: '',
    answer1: 'Ok',
    answer2: '',
    yes: null,
    no: null,
    alertType: AlertType.Success
  }
  dialogUpdate;

  constructor(public dialogService: DialogService, private appService: AppService, private renderer: Renderer2) {
  }

  ngOnInit() {
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
      setTimeout(function () {
        $('.modal-backdrop').not('.modal-stack').css('z-index', zIndex - 1).addClass('modal-stack');
      }, 0);
    });
    this.appService.successMsg$.subscribe(() => {
      this.showSuccessMessage();
    });
  }

  @ViewChild('addVideoSuccess') successMsgEl: ElementRef;

  showSuccessMessage() {
    const successEl = this.successMsgEl.nativeElement;
    this.renderer.addClass(successEl, 'grow-in');
    this.renderer.removeClass(successEl, 'none');

    setTimeout(() => {
      this.renderer.removeClass(successEl, 'grow-in');
      this.renderer.addClass(successEl, 'grow-out');

      setTimeout(() => {
        this.renderer.addClass(successEl, 'none');
        this.renderer.removeClass(successEl, 'grow-out');
      }, 500);
    }, 510);
  }

  ngOnDestroy() {
    this.dialogUpdate.unsubscribe();
  }
}
