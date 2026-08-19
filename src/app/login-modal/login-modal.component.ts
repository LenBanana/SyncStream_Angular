import { Component, OnInit, Input, OnChanges, ViewChild, ElementRef, Output, EventEmitter, OnDestroy } from '@angular/core';
import { User } from '../Interfaces/User';
import { AuthService } from '../services/auth.service';
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

  constructor(private authService: AuthService) { }
  @ViewChild('userLoginInput') userLoginElement: ElementRef;
  @ViewChild('pwLoginInput') pwLoginElement: ElementRef;
  @Output() SaveLogin = new EventEmitter();
  @Input() user: User;
  @Input() logout: boolean;
  Valid: string;
  loginError = false;
  loginErrorString = "Username error";
  pwError = false;
  pwErrorString = "Password error";
  loginInvalid = false;
  pwInvalid = false;
  regExStringUsername = /^\w(?:\w|[.-](?=\w)){2,31}$/;

  ngOnInit(): void {
  }

  ngOnDestroy() {
  }

  LoginRequest() {
    const credentials = this.validateUserRequest();
    if (!credentials) {
      return;
    }

    this.authService.login(credentials.username, credentials.password).subscribe(result => {
      if (!result.ok) {
        this.loginErrorString = result.message;
        this.loginError = true;
        setTimeout(() => {
          this.loginError = false;
        }, 3000);

        // An account waiting for approval is a real account, so say so rather than showing it as a
        // failed sign-in.
        if (result.awaitingApproval) {
          $('#loginModal').modal('hide');
          $('#registerModal').modal('show');
        }
        return;
      }

      const user = this.authService.user.value;
      this.SaveLogin.emit(user);
      this.user = user;
      MainUser.approved = user.approved;
      MainUser.userprivileges = user.userprivileges;
      MainUser.username = user.username;
      this.logout = true;
      this.clearInputs();
      $('#loginModal').modal('hide');
    });
  }

  RegisterRequest() {
    const credentials = this.validateUserRequest();
    if (!credentials) {
      return;
    }

    this.authService.register(credentials.username, credentials.password).subscribe(result => {
      if (!result.ok) {
        this.loginErrorString = result.message;
        this.loginError = true;
        setTimeout(() => {
          this.loginError = false;
        }, 3000);
        return;
      }

      // Registration does not sign you in: the account is unapproved until an admin approves it.
      this.clearInputs();
      $('#loginModal').modal('hide');
      $('#registerModal').modal('show');
    });
  }

  private clearInputs() {
    this.userLoginElement.nativeElement.value = "";
    this.pwLoginElement.nativeElement.value = "";
  }

  LoginInvalid() {
    const username: string = this.userLoginElement.nativeElement.value;
    var regEx = new RegExp(this.regExStringUsername);
    this.loginInvalid = !username || !regEx.test(username);
    return this.loginInvalid;
  }

  PasswordInvalid() {
    const pw: string = this.pwLoginElement.nativeElement.value;
    this.pwInvalid = !pw || pw.length < 6 || pw.length > 80;
    return this.pwInvalid;
  }

  validateUserRequest(): User {
    const username: string = this.userLoginElement.nativeElement.value;
    const pw: string = this.pwLoginElement.nativeElement.value;
    var regEx = new RegExp(this.regExStringUsername);
    if (!this.LoginInvalid()) {
      if (!this.PasswordInvalid()) {
        const pwSha: string = sha512.sha512(pw);
        if (pwSha) {
          const user: User = { username: username, password: pwSha, id: 0, approved: 0, userprivileges: 0, streamToken: "", apiKey: ""};
          return user;
        }
      } else {
        this.pwErrorString = "Password invalid";
        this.pwError = true;
        setTimeout(() => {
          this.pwError = false;
        }, 3000);
        return null;
      }
    } else {
      this.loginErrorString = "Username invalid";
      this.loginError = true;
      setTimeout(() => {
        this.loginError = false;
      }, 3000);
      return null;
    }
  }

}
