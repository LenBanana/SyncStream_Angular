import { Injectable } from '@angular/core';
import { hubConnection, baseUrl } from '../../services/signal-r.service';
import { BehaviorSubject, from } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { User } from '../../Interfaces/User';
import { RememberToken } from '../../Interfaces/RememberToken';
import { token } from '../../global.settings';

@Injectable({
  providedIn: 'root'
})
export class UserSettingService {
  Token = token;

  Users: BehaviorSubject<User[]> = new BehaviorSubject(null);
  constructor(private http: HttpClient) { }


  public ChangeUser(User: User, Password: string) {
    hubConnection.invoke('ChangeUser', User, Password);
  }

  public GenerateApiKey() {
    if (this.Token) {
      hubConnection.invoke('GenerateApiKey', this.Token);
    }
  }
}
