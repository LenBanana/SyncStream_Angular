import { Injectable } from '@angular/core';
import { token } from '../../global.settings';
import { HttpClient } from '@angular/common/http';
import { SignalRService, hubConnection } from '../../services/signal-r.service';
import { BehaviorSubject } from 'rxjs';
import { AuthenticationType, UserPrivileges } from '../../user-admin-modal/user-admin-modal.component';

@Injectable({
  providedIn: 'root'
})
export class PermissionViewService {
  privilegeInfos: BehaviorSubject<PrivilegeInfo[]> = new BehaviorSubject(null);
  constructor(private signalRService: SignalRService,private http: HttpClient) {
    signalRService.connectionClosed.subscribe(isClosed => {
      if (isClosed===false) {
        this.addPrivilegeInfoListener();
      }
      if (isClosed===true) {
        this.removePrivilegeInfoListener();
      }
    });
   }

   public addPrivilegeInfoListener() {
     hubConnection.on('getPrivilegeInfo', (data) => {
       this.privilegeInfos.next(data);
     });
   }

   public removePrivilegeInfoListener() {
     hubConnection.off('getPrivilegeInfo', (data) => {
     });
   }

  public GetPermissions() {
    if (token) {
      hubConnection.invoke('GetPermissions', token);
    }
  }
}


export interface PrivilegeInfo {
  methodName: string,
  typeName: string,
  description: string,
  requiredPrivileges: UserPrivileges,
  authenticationType: AuthenticationType
}
