import { Component, OnInit } from '@angular/core';
import { DownloadService } from './download-service/download-service.service';

@Component({
  selector: 'app-download-modal',
  templateUrl: './download-modal.component.html',
  styleUrls: ['./download-modal.component.scss']
})
export class DownloadModalComponent implements OnInit {

  constructor(public downloadService: DownloadService) { }

  listenId: string
  dlStart = false;
  currentStatus = '';
  ngOnInit(): void {
    var uniqid = Date.now() + '' + Math.round((Math.random() * 100000));
    this.listenId = uniqid.toString();
    this.downloadService.addDownloadListener(this.listenId);
    this.downloadService.dlUpdates.subscribe(update => {
      this.currentStatus = JSON.stringify(update);
      if (this.currentStatus.includes('completed')) {
        setTimeout(() => {
          this.dlStart = false;          
        }, 2000);
      }
    });
  }

  downloadRequest() {
    var url = (document.getElementById('url') as HTMLInputElement).value;
    var name = (document.getElementById('name') as HTMLInputElement).value;
    if (url && name && url.startsWith("http") && name.length > 2) {
      this.dlStart = true;
      this.downloadService.sendDownloadRequst(url, name, this.listenId);
    }
  }

}
