import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { User } from '../Interfaces/User';
import { resolveApiBaseUrl } from '../core/api-origin';

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

  constructor(private http: HttpClient) {}

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

  login(username: string, passwordHash: string): Observable<AuthResult> {
    return this.http.post<User>(this.base + 'login', { username, password: passwordHash }).pipe(
      map(user => {
        this.user.next(user);
        return { ok: true } as AuthResult;
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

  register(username: string, passwordHash: string): Observable<AuthResult> {
    return this.http.post<User>(this.base + 'register', { username, password: passwordHash }).pipe(
      // Registration deliberately does not sign you in: the account is unapproved until an admin says so.
      map(() => ({ ok: true, awaitingApproval: true } as AuthResult)),
      catchError((error: HttpErrorResponse) =>
        of({ ok: false, message: messageFrom(error, 'Could not register') })
      )
    );
  }

  logout(): Observable<AuthResult> {
    return this.http.post(this.base + 'logout', {}).pipe(
      map(() => {
        this.user.next(null);
        return { ok: true } as AuthResult;
      }),
      catchError((error: HttpErrorResponse) => {
        // The cookie may already be gone, in which case the user is signed out either way.
        this.user.next(null);
        return of({ ok: false, message: messageFrom(error, 'Could not sign out') });
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

  /** Changes username and/or password. Both hashes are SHA512, computed by the caller. */
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
