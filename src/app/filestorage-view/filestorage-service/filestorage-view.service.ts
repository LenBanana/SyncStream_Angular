import { Injectable } from '@angular/core';
import { token } from '../../global.settings';
import { HttpClient } from '@angular/common/http';
import { SignalRService, hubConnection } from '../../services/signal-r.service';
import { BehaviorSubject } from 'rxjs';
import { AuthenticationType, UserPrivileges } from '../../user-admin-modal/user-admin-modal.component';

@Injectable({
  providedIn: 'root'
})
export class FilestorageViewService {
  storageInfos: BehaviorSubject<FileStorageInfo[]> = new BehaviorSubject(null);
  constructor(private signalRService: SignalRService,private http: HttpClient) {
    signalRService.connectionClosed.subscribe(isClosed => {
      if (isClosed===false) {
        this.addStorageInfoListener();
      }
      if (isClosed===true) {
        this.removeStorageInfoListener();
      }
    });
   }

   public addStorageInfoListener() {
     hubConnection.on('getStorageInfo', (data) => {
       this.storageInfos.next(data);
     });
   }

   public removeStorageInfoListener() {
     hubConnection.off('getStorageInfo', (data) => {
     });
   }

  public GetStorageInfo() {
    if (token) {
      hubConnection.invoke('GetStorageInfo', token);
    }
  }
}


export interface FileStorageInfo {
  path: string,
  totalSize: number,
  fileCount: number,
  directoryCount: number,
  largestFiles: string[],
  totalDiskSpace: number
}
