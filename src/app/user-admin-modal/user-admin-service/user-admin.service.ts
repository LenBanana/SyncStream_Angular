import { Injectable } from '@angular/core';
import { hubConnection, baseUrl, SignalRService } from '../../services/signal-r.service';
import { BehaviorSubject, from } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { User } from '../../Interfaces/User';
import { RememberToken } from '../../Interfaces/RememberToken';
import { AlertType } from '../../Interfaces/Dialog';
import { ServerHealth } from '../../Interfaces/ServerHealth';

@Injectable({
  providedIn: 'root'
})
export class UserAdminService {

  Users: BehaviorSubject<User[]> = new BehaviorSubject(null);
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

  public PublicAnnouncement(token: string, message: string, alertType: AlertType) {
    hubConnection.invoke('PublicAnnouncement', token, message, alertType);
  }

  public GetUsers(token: string, userID: number) {
    hubConnection.invoke('GetUsers', token, userID);
  }

  public DeleteUser(token: string, userID: number, removeID: number) {
    hubConnection.invoke('DeleteUser', token, userID, removeID);
  }//SetUserPrivileges

  public ApproveUser(token: string, userID: number, approveID: number, prove: boolean) {
    hubConnection.invoke('ApproveUser', token, userID, approveID, prove);
  }

  public SetUserPrivileges(token: string, userID: number, changeID: number, privileges: number) {
    hubConnection.invoke('SetUserPrivileges', token, userID, changeID, privileges);
  }

  public addUserListener() {
    hubConnection.on('getusers', (data: User[]) => {
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
