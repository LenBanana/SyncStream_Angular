import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, from, of } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';
import { User } from '../Interfaces/User';
import { UserPrivileges } from '../user-admin-modal/user-admin-modal.component';
import { resolveApiBaseUrl } from '../core/api-origin';
import { SignalRService } from './signal-r.service';

export interface AuthResult {
  ok: boolean;
  /** Set when ok is false. Safe to show to the user. */
  message?: string;
  /** True when the account exists but an admin has not approved it yet. */
  awaitingApproval?: boolean;
}

/**
 * Signing in, out, and knowing who you are.
 *
 * These are HTTP calls rather than hub invocations because the session is an HttpOnly cookie and a
 * cookie can only be set on an HTTP response; a hub invocation has none. The token is never visible to
 * this code, which is the point: there is nothing here for an XSS to steal.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  /** The signed-in user, or null. Null is a real value here, meaning "signed out". */
  readonly user: BehaviorSubject<User | null> = new BehaviorSubject<User | null>(null);

  private readonly base = resolveApiBaseUrl() + 'api/auth/';

  constructor(private http: HttpClient, private signalR: SignalRService) {}

  /**
   * What the signed-in account is allowed to do, or NotApproved when signed out.
   *
   * The single place the client answers "can I". Privileges used to be copied into component inputs and a
   * module-global at login and never revised, so signing out left the UI offering actions the server would
   * refuse, and an admin granting a privilege mid-session had no effect until a reload.
   */
  get privileges(): UserPrivileges {
    const profile = this.user.value;
    return profile && profile.approved > 0 ? profile.userprivileges : UserPrivileges.NotApproved;
  }

  /** Whether the caller holds at least this level. Unapproved accounts hold nothing, as on the server. */
  hasAtLeast(level: UserPrivileges): boolean {
    return this.privileges >= level;
  }

  /** Restores the session on page load. Resolves to null when there is no valid cookie. */
  restore(): Observable<User | null> {
    return this.http.get<User>(this.base + 'me', { observe: 'response' }).pipe(
      map(response => (response.status === 204 ? null : response.body)),
      tap(user => this.user.next(user)),
      catchError(() => {
        this.user.next(null);
        return of(null);
      })
    );
  }

  /**
   * Signs in, then reopens the hub connection before reporting success.
   *
   * The reconnect is awaited rather than started and forgotten, because the caller acts on the result at once,
   * usually by joining a room. A hub connection takes its identity from the handshake and keeps it, so until it
   * is replaced the server still sees the same anonymous caller no matter what the cookie now says.
   */
  login(username: string, password: string): Observable<AuthResult> {
    return this.http.post<User>(this.base + 'login', { username, password }).pipe(
      switchMap(user => {
        this.user.next(user);
        return from(this.signalR.restartConnection()).pipe(map(() => ({ ok: true } as AuthResult)));
      }),
      catchError((error: HttpErrorResponse) => {
        this.user.next(null);
        return of({
          ok: false,
          message: messageFrom(error, 'Could not sign in'),
          awaitingApproval: error.status === 403
        });
      })
    );
  }

  register(username: string, password: string): Observable<AuthResult> {
    return this.http.post<User>(this.base + 'register', { username, password }).pipe(
      // Registration deliberately does not sign you in: the account is unapproved until an admin says so.
      map(() => ({ ok: true, awaitingApproval: true } as AuthResult)),
      catchError((error: HttpErrorResponse) =>
        of({ ok: false, message: messageFrom(error, 'Could not register') })
      )
    );
  }

  /**
   * Signs out, and replaces the hub connection whether or not the request succeeded.
   *
   * Clearing the cookie does not change the identity of a connection that is already open, so without this the
   * hub went on accepting calls with the privileges of the account that had just signed out until the page was
   * reloaded.
   */
  logout(): Observable<AuthResult> {
    return this.http.post(this.base + 'logout', {}).pipe(
      switchMap(() => {
        this.user.next(null);
        return from(this.signalR.restartConnection()).pipe(map(() => ({ ok: true } as AuthResult)));
      }),
      catchError((error: HttpErrorResponse) => {
        // The cookie may already be gone, in which case the user is signed out either way. The connection is
        // replaced regardless, so a failed sign-out cannot leave a privileged connection open.
        this.user.next(null);
        return from(this.signalR.restartConnection()).pipe(
          map(() => ({ ok: false, message: messageFrom(error, 'Could not sign out') } as AuthResult)));
      })
    );
  }

  /**
   * Issues a fresh API key and pushes the updated profile.
   *
   * Was a hub call answered by a `userlogin` event. Nothing listened for that event once login moved off
   * the hub, so the key was created server-side and never appeared in the UI.
   */
  generateApiKey(): Observable<AuthResult> {
    return this.http.post<User>(this.base + 'api-key', {}).pipe(
      map(user => {
        this.user.next(user);
        return { ok: true } as AuthResult;
      }),
      catchError((error: HttpErrorResponse) =>
        of({ ok: false, message: messageFrom(error, 'Could not generate an API key') })
      )
    );
  }

  /** Changes username and/or password. Both are sent as typed; the server hashes them. */
  changeUser(
    username: string | null,
    newPasswordHash: string | null,
    currentPasswordHash: string
  ): Observable<AuthResult> {
    return this.http
      .post<{ message: string }>(this.base + 'change-user', {
        username,
        newPassword: newPasswordHash,
        currentPassword: currentPasswordHash
      })
      .pipe(
        map(response => ({ ok: true, message: response?.message })),
        catchError((error: HttpErrorResponse) =>
          of({ ok: false, message: messageFrom(error, 'Could not save your changes') })
        )
      );
  }
}

function messageFrom(error: HttpErrorResponse, fallback: string): string {
  const message = error?.error?.message;
  return typeof message === 'string' && message.length > 0 ? message : fallback;
}
