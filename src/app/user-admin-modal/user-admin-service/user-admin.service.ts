import { Injectable } from '@angular/core';
import { hubConnection, baseUrl, SignalRService } from '../../services/signal-r.service';
import { BehaviorSubject, from } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { User, UserSummary } from '../../Interfaces/User';
import { AlertType } from '../../Interfaces/Dialog';
import { ServerHealth } from '../../Interfaces/ServerHealth';

@Injectable({
  providedIn: 'root'
})
export class UserAdminService {

  Users: BehaviorSubject<UserSummary[]> = new BehaviorSubject(null);
  ServerHealth: BehaviorSubject<ServerHealth> = new BehaviorSubject(null);
  constructor(private http: HttpClient, private signalRService: SignalRService) {
    signalRService.connectionClosed.subscribe(isClosed => {
      if (isClosed===false) {
        this.addUserListener();
        this.addServerHealthListener();
      }
      if (isClosed===true) {
        this.removeUserListener();
        this.removeServerHealthListener();
      }
    });
   }

  public NullAllSubs() {
    this.Users.next(null);
  }

  public PublicAnnouncement(message: string, alertType: AlertType) {
    hubConnection.invoke('PublicAnnouncement', message, alertType);
  }

  public GetUsers() {
    hubConnection.invoke('GetUsers');
  }

  // The acting user is the connection's own identity, so only the target is passed.
  public DeleteUser(removeID: number) {
    hubConnection.invoke('DeleteUser', removeID);
  }

  public ApproveUser(approveID: number, prove: boolean) {
    hubConnection.invoke('ApproveUser', approveID, prove);
  }

  public SetUserPrivileges(changeID: number, privileges: number) {
    hubConnection.invoke('SetUserPrivileges', changeID, privileges);
  }

  public addUserListener() {
    hubConnection.on('getusers', (data: UserSummary[]) => {
      this.Users.next(data);
    });
  }

  public removeUserListener() {
    hubConnection.off('getusers');
    this.Users.next(null);
  }

  public addServerHealthListener() {
    hubConnection.on('serverHealth', (data: ServerHealth) => {
      this.ServerHealth.next(data);
    });
  }

  public removeServerHealthListener() {
    hubConnection.off('serverHealth');
    this.Users.next(null);
  }
}
