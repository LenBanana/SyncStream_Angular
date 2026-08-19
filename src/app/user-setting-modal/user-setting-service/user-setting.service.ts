import { Injectable } from '@angular/core';
import { hubConnection } from '../../services/signal-r.service';

@Injectable({
  providedIn: 'root'
})
export class UserSettingService {

  public GenerateApiKey() {
    hubConnection.invoke('GenerateApiKey');
  }
}
