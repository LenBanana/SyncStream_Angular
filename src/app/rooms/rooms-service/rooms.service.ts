import { Injectable } from '@angular/core';
import { hubConnection, baseUrl } from '../../services/signal-r.service';
import { BehaviorSubject, from } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { User } from 'src/app/Interfaces/User';
import { RememberToken } from 'src/app/Interfaces/RememberToken';

@Injectable({
  providedIn: 'root'
})
export class RoomService {

  constructor(private http: HttpClient) { }



  public GenerateRememberToken(user: User, userInfo: string) {
    hubConnection.invoke('GenerateRememberToken', user, userInfo);
  }
}
