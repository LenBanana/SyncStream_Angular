import { Injectable } from '@angular/core';
import { Member } from '../../Interfaces/Member';
import { BehaviorSubject } from 'rxjs';
import { hubConnection, SignalRService } from '../../services/signal-r.service';
import { Room } from 'src/app/Interfaces/Room';

@Injectable({
  providedIn: 'root'
})
export class UserlistService {
  members: BehaviorSubject<Member[]> = new BehaviorSubject(null);
  host: BehaviorSubject<boolean> = new BehaviorSubject(null);
  addUserFail: BehaviorSubject<number> = new BehaviorSubject(null);
  constructor(private signalRService: SignalRService) {
    signalRService.connectionClosed.subscribe(isClosed => {
      if (isClosed===false) {
        this.addHostListener();
        this.addMemberListener();
        this.addUserListener();
      }
      if (isClosed===true) {
        this.removeHostListener();
        this.removeMemberListener();
        this.removeUserListener();
      }
    });
   }

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
    hubConnection.off('adduserupdate');
    this.addUserFail.next(null);
  }

  public addMemberListener() {
    hubConnection.on('userupdate', (data: Member[]) => {
      this.members.next(data);
    });
  }

  public removeMemberListener() {
    hubConnection.off('userupdate');
    this.members.next(null);
  }

  public addHostListener() {
    hubConnection.on('hostupdate', (data: boolean) => {
      this.host.next(data);
    });
  }

  public removeHostListener() {
    hubConnection.off('hostupdate');
    this.host.next(null);
  }

}
