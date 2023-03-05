import {
  Injectable
} from '@angular/core';
import * as signalR from "@aspnet/signalr";
import {
  BehaviorSubject
} from 'rxjs';
import { RememberToken } from '../Interfaces/RememberToken';
import { randomIntFromInterval } from '../helper/generic';
import { User } from '../Interfaces/User';
import { Room } from '../Interfaces/Room';
import { Token } from '../helper/Globals';
import { getCookie } from '../global.settings';
export var hubConnection: signalR.HubConnection;
export var CurrentPing: number = 0.5;
export var baseUrl: string = "https://sync.dreckbu.de/";
//export var baseUrl: string = "https://localhost:5001/";
//export var baseUrl: string = "https://localhost:32780/";
@Injectable({
  providedIn: 'root'
})

export class SignalRService {
  room: BehaviorSubject <Room[]> = new BehaviorSubject([]);
  tokenUpdate: BehaviorSubject<RememberToken> = new BehaviorSubject(null);
  connectionClosed: BehaviorSubject < boolean > = new BehaviorSubject(null);
  loginRequest: BehaviorSubject<User> = new BehaviorSubject(null);
  registerRequest: BehaviorSubject<User> = new BehaviorSubject(null);
  pingStream: BehaviorSubject<number> = new BehaviorSubject(CurrentPing);

  public AddLoginListener() {
    hubConnection.on('userlogin', (data) => {
      this.loginRequest.next(data);
    });
  }

  public RemoveLoginListener() {
    hubConnection.off('userlogin');
    this.loginRequest.next(null);
  }

  public AddRegisterListener() {
    hubConnection.on('userRegister', (data) => {
      this.registerRequest.next(data);
    });
  }

  public RemoveRegisterListener() {
    hubConnection.off('userRegister');
    this.registerRequest.next(null);
  }

  public LoginRequest(user: User, userInfo: string) {
    hubConnection.invoke('LoginRequest', user, userInfo);
  }

  public RegisterRequest(user: User) {
    hubConnection.invoke('RegisterRequest', user);
  }

  public async startConnection() {
    this.tokenUpdate.subscribe(result => {
      if (result==null) {
        return;
      }
      const curDate = new Date();
      curDate.setDate(curDate.getDate() + 30);
      document.cookie = "login-token=" + result.token + "; expires=" + curDate.toUTCString() + "; path=/";
      document.cookie = "user-id=" + result.userID + "; expires=" + curDate.toUTCString() + "; path=/";
    });


    hubConnection = new signalR.HubConnectionBuilder()
      .withUrl(baseUrl + 'server')
      .build();

    await this.connect().finally(() => {
      hubConnection.onclose(() => {
        console.log("Connection closed... Attempting to reconnect");
        this.connectionClosed.next(true);
        this.removeRoomListener();
        this.RemoveLoginListener();
        this.RemoveRegisterListener();
        this.RemovePingListener();
        this.RemoveTokenListener();
        setTimeout(() => {
          this.connect();
        }, 1000);
      });
    });
  }

  public async connect() {
    await hubConnection
      .start()
      .then(() => {
        console.log('Connection started');
        this.addRoomListener();
        this.AddLoginListener();
        this.AddRegisterListener();
        this.AddPingListener();
        this.AddTokenListener();
        this.connectionClosed.next(false);

        var token = getCookie("login-token");
        var userId = getCookie("user-id");
        if (token==undefined) {
          token = "";
        }
        var userNo = Number.parseInt(userId);
        if (!userId || userId == undefined || isNaN(userNo)) {
          userId = "-1";
        }
        var numberId = Number.parseInt(userId);
        this.ValidateToken(token, numberId);
      })
      .catch(async err => {
        console.log('Error while starting connection: ' + err + '... Attempting to reconnect');
        await hubConnection
          .stop()
          .then(() => {
            console.log('Connection stopped');
            setTimeout(() => {
              this.connect();
            }, 1000);
          })
          .catch(err => console.log('Error while stopping connection: ' + err))
      });
  }

  public async stopConnection() {
    await hubConnection
      .stop()
      .then(() => console.log('Connection stopped'))
      .catch(err => console.log('Error while stopping connection: ' + err))
  }

  public addRoomListener() {
    hubConnection.on('getrooms', (data) => {
      this.room.next(data);
    });
  }

  public removeRoomListener() {
    hubConnection.off('getrooms', (data) => {});
    this.room.next(null);
  }

  public addRoom(room: Room) {
    hubConnection.invoke('AddRoom', room);
  }

  public removeRoom(UniqueId: string) {
    hubConnection.invoke('RemoveRoom', UniqueId);
  }

  public AddTokenListener() {
    hubConnection.on('rememberToken', (data) => {
      var token = data as RememberToken;
      Token.token = token.token;
      Token.id = token.id;
      Token.userID = token.userID;
      this.tokenUpdate.next(data);
    });
  }

  public AddPingListener() {
    hubConnection.on('PingTest', (date: Date) => {
      let diff = new Date().getTime() - new Date(date).getTime();
      CurrentPing = (diff / 1000);
      this.pingStream.next(CurrentPing);
    });
  }

  public RemovePingListener() {
    hubConnection.off('PingTest', (date) => {
    });
  }

  public RemoveTokenListener() {
    hubConnection.off('rememberToken');
    this.tokenUpdate.next(null);
  }

  public ValidateToken(token: string, userId: number) {
    hubConnection.invoke('ValidateToken', token, userId);
  }
}
