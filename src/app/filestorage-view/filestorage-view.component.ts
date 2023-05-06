import { Component, OnDestroy, OnInit } from '@angular/core';
import { FileStorageInfo, FilestorageViewService } from './filestorage-service/filestorage-view.service';
import { Subscription } from 'rxjs';
declare var $: any;

@Component({
  selector: 'app-filestorage-view',
  templateUrl: './filestorage-view.component.html',
  styleUrls: ['./filestorage-view.component.scss']
})
export class FilestorageViewComponent implements OnInit, OnDestroy {

  storageInfo: FileStorageInfo[] = [];
  storageInfoSub: Subscription;
  constructor(private storageService: FilestorageViewService) { }

  ngOnInit(): void {
    this.storageInfoSub = this.storageService.storageInfos.subscribe(f => {
      if (!f || f == null) {
        return;
      }
      this.storageInfo = f;
    });
    $( "#storageInfoModal" ).on('shown.bs.modal', () => {
      this.GetStorageInfo()
    });
  }

  ngOnDestroy(): void {
    this.storageInfoSub.unsubscribe();
    $( "#storageInfoModal" ).off();
  }

  GetStorageInfo() {
    this.storageService.GetStorageInfo();
  }
}
