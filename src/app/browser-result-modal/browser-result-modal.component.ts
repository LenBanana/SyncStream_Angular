import { Component, EventEmitter, OnDestroy, OnInit, Output } from '@angular/core';
import { DownloadManagerService } from '../download-manager/download-manger-service/download-manager.service';
import { DialogService } from '../text-dialog/text-dialog-service/dialog-service.service';
declare var $: any;

@Component({
  selector: 'app-browser-result-modal',
  templateUrl: './browser-result-modal.component.html',
  styleUrls: ['./browser-result-modal.component.scss']
})
export class BrowserResultModalComponent implements OnInit, OnDestroy {

  constructor(private downloadService: DownloadManagerService, private dialogService: DialogService) { }
  @Output() copyFile = new EventEmitter();
  results: string[] = [];
  browserResults;
  ngOnInit(): void {
    this.browserResults = this.downloadService.browserResults.subscribe(x => {
      if (!x || x == null) {
        return;
      }
      this.results = x;
      $('#browserResultModal').modal('show');
    })
  }

  ngOnDestroy(): void {
      this.browserResults.unsubscribe();
  }

  emitText(txt: string) {
    this.copyFile.emit(txt);
    $('#browserResultModal').modal('hide');
  }

}
