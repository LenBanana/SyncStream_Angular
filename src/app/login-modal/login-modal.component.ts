import { Component, OnInit, Input, OnChanges, ViewChild, ElementRef, Output, EventEmitter, OnDestroy } from '@angular/core';
import { User } from '../Interfaces/User';
import { SignalRService } from '../services/signal-r.service';
import { MainUser } from '../helper/Globals';
import { randomIntFromInterval } from '../helper/generic';
import * as sha512 from 'js-sha512';
declare var $:any

@Component({
  selector: 'app-login-modal',
  templateUrl: './login-modal.component.html',
  styleUrls: ['./login-modal.component.scss']
})
export class LoginModalComponent implements OnInit, OnDestroy {

  constructor(public signalRService: SignalRService) { }
  @ViewChild('userLoginInput') userLoginElement: ElementRef;
  @ViewChild('pwLoginInput') pwLoginElement: ElementRef;
  @Output() SaveLogin = new EventEmitter();
  @Input() user: User;
  @Input() logout: boolean;
  Valid: string;
  loginError = false;
  userExist = false;
  wrongPw = false;
  loginRequest;
  registerRequest;
  
  ngOnInit(): void {  
    this.signalRService.AddLoginListener();
    this.signalRService.AddRegisterListener();
    this.loginRequest = this.signalRService.loginRequest.subscribe(result => { 
      if (result == null || result.username == null) {
        this.wrongPw = true;
        setTimeout(() => {
          this.wrongPw = false;
        }, 5000);
        return;
      }
      this.SaveLogin.emit(result);
      this.user = result;  
      MainUser.approved = result.approved;
      MainUser.userprivileges = result.userprivileges;
      MainUser.username = result.username;
      this.logout = true;
      this.userLoginElement.nativeElement.value = "";
      this.pwLoginElement.nativeElement.value = "";
      $('#loginModal').modal('hide');
    });

    this.registerRequest = this.signalRService.registerRequest.subscribe(result => { 
      if (result == null) {
        this.userExist = true;
        setTimeout(() => {
          this.userExist = false;
        }, 5000);
        return;
      }
      this.SaveLogin.emit(result);
      this.user = result;   
      this.logout = true;
      this.userLoginElement.nativeElement.value = "";
      this.pwLoginElement.nativeElement.value = "";
      $('#loginModal').modal('hide');
      $('#registerModal').modal('show');
    });    
  } 

  ngOnDestroy() {
    this.signalRService.RemoveLoginListener();
    this.signalRService.RemoveRegisterListener();
    this.loginRequest.unsubscribe();
    this.registerRequest.unsubscribe();
  }

  public LoginRequest() {
    const user: User = this.validateUserRequest();
    if (user) {
      this.signalRService.LoginRequest(user);
    }
  }

  public RegisterRequest() {
    const user: User = this.validateUserRequest();
    if (user) {
      this.signalRService.RegisterRequest(user);
    }
  }

  public validateUserRequest(): User {
    const username: string = this.userLoginElement.nativeElement.value;
    const pw: string = this.pwLoginElement.nativeElement.value;
    if (username && pw && username.length >= 3 && pw.length >= 6 && username.length <= 20) {
      const pwSha: string = sha512.sha512(pw);
      if (pwSha) {
        const user: User = { username: username, password: pwSha, id: 0, approved: 0, userprivileges: 0};
        return user;
      }
    } else {
      this.loginError = true;
        setTimeout(() => {
          this.loginError = false;
        }, 5000);
        return null;
    }
  }

}
