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

export var hubConnection: signalR.HubConnection;
//export var baseUrl: string = "https://sync.dreckbu.de/";
export var baseUrl: string = "https://localhost:5001/";
@Injectable({
  providedIn: 'root'
})

export class SignalRService {
  room: BehaviorSubject <Room[]> = new BehaviorSubject([]);
  tokenUpdate: BehaviorSubject<RememberToken> = new BehaviorSubject(null);
  connectionClosed: BehaviorSubject < boolean > = new BehaviorSubject(false);
  loginRequest: BehaviorSubject<User> = new BehaviorSubject(null);
  registerRequest: BehaviorSubject<User> = new BehaviorSubject(null);
  
  public AddLoginListener() {
    hubConnection.on('userlogin', (data) => {
      this.loginRequest.next(data);
    });
  }

  public RemoveLoginListener() {
    hubConnection.off('userlogin', (data) => {
    });
  }

  public AddRegisterListener() {
    hubConnection.on('userRegister', (data) => {
      this.registerRequest.next(data);
    });
  }

  public RemoveRegisterListener() {
    hubConnection.off('userRegister', (data) => {
    });
  }
  
  public LoginRequest(user: User) {
    hubConnection.invoke('LoginRequest', user);
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
      document.cookie = "login-token=" + result.token + "; expires=" + curDate.toUTCString();
      document.cookie = "user-id=" + result.userID + "; expires=" + curDate.toUTCString();
    });
    

    hubConnection = new signalR.HubConnectionBuilder()
      .withUrl(baseUrl + 'server')
      .build();

    await this.connect().finally(() => {
      hubConnection.onclose(() => {
        this.connectionClosed.next(true);
        console.log("Connection closed... Attempting to reconnect");
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
        this.AddTokenListener();        
        var token = this.getCookie("login-token");
        var userId = this.getCookie("user-id");
        if (token==undefined) {
          token = "";
        }
        if (userId == undefined) {
          userId = "-1";
        }
        this.ValidateToken(token, Number.parseInt(userId));
        this.connectionClosed.next(false);
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

  public getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
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

  public RemoveTokenListener() {
    hubConnection.off('rememberToken', (data) => {
    });
  }

  public ValidateToken(token: string, userId: number) {
    hubConnection.invoke('ValidateToken', token, userId);
  }
}
