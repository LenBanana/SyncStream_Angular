import { Injectable } from '@angular/core';
import { hubConnection, baseUrl } from '../../services/signal-r.service';
import { BehaviorSubject, from } from 'rxjs';
import { HttpClient } from '@angular/common/http';

@Injectable({
  providedIn: 'root'
})
export class RoomService {

  public JoinRoom: BehaviorSubject<string> = new BehaviorSubject(null);
  public LeaveRoom: BehaviorSubject<string> = new BehaviorSubject(null);
  constructor(private http: HttpClient) { }

  public GetRooms() {
    hubConnection.invoke('GetRooms');
  }
}
