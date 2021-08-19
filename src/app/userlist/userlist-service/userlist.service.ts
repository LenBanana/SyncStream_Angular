import { Injectable } from '@angular/core';
import { Member } from '../../Interfaces/Member';
import { BehaviorSubject } from 'rxjs';
import { hubConnection } from '../../services/signal-r.service';
import { Room } from 'src/app/Interfaces/Room';

@Injectable({
  providedIn: 'root'
})
export class UserlistService {
  members: BehaviorSubject<Member[]> = new BehaviorSubject(null);
  host: BehaviorSubject<boolean> = new BehaviorSubject(null);
  addUserFail: BehaviorSubject<number> = new BehaviorSubject(null);
  constructor() { }

  public addUser(username: string, UniqueId: string, password: string) {
    hubConnection.invoke('AddUser', username, UniqueId, password);
  }

  public banUser(username: string, UniqueId: string) {
    hubConnection.invoke('BanUser', username, UniqueId);
  }

  public removeUser(username: string, UniqueId: string) {
    hubConnection.invoke('RemoveUser', username, UniqueId);
  }

  public updateUser(username: string, UniqueId: string) {
    hubConnection.invoke('UpdateUser', username, UniqueId);
  }

  public changeHost(usernameMember: string, UniqueId: string) {
    hubConnection.invoke('ChangeHost', usernameMember, UniqueId);
  }

  public addUserListener() {
    hubConnection.on('adduserupdate', (data: number) => {
      this.addUserFail.next(data);
    });
  }

  public removeUserListener() {
    hubConnection.off('adduserupdate', (data) => {});
  }

  public addMemberListener() {
    hubConnection.on('userupdate', (data: Member[]) => {
      this.members.next(data);
    });
  }

  public removeMemberListener() {
    hubConnection.off('userupdate', (data) => {});
  }

  public addHostListener() {
    hubConnection.on('hostupdate', (data: boolean) => {
      this.host.next(data);
    });
  }

  public removeHostListener() {
    hubConnection.off('hostupdate', (data) => {});
  }

}
