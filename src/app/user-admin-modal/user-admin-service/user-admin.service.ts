import { Injectable } from '@angular/core';
import { hubConnection, baseUrl } from '../../services/signal-r.service';
import { BehaviorSubject, from } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { User } from 'src/app/Interfaces/User';
import { RememberToken } from 'src/app/Interfaces/RememberToken';

@Injectable({
  providedIn: 'root'
})
export class UserAdminService {

  Users: BehaviorSubject<User[]> = new BehaviorSubject(null);
  constructor(private http: HttpClient) { }


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
}
