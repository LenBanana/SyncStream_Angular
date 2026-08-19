import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { AuthService } from './auth.service';
import { SignalRService } from './signal-r.service';

/**
 * Signing in and out.
 *
 * A hub connection is given its identity during the handshake and keeps it for as long as it lives, so
 * authenticating over HTTP tells an open connection nothing. The connection has to be replaced, and the caller
 * must not be told it is signed in until that has happened, because the first thing it does is act on it.
 */
describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;
  let events: string[];

  beforeEach(() => {
    events = [];

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        AuthService,
        {
          provide: SignalRService,
          useValue: {
            // Records when the reconnect *finishes*, not when it is called. Recording the call instead makes the
            // test pass whether or not the promise is awaited, since either way the call happens first, which is
            // the one thing this needs to tell apart.
            restartConnection: () => new Promise<void>(resolve => setTimeout(() => {
              events.push('connection replaced');
              resolve();
            }, 0))
          }
        }
      ]
    });

    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('replaces the connection before reporting a successful sign-in', async () => {
    // The order is the whole point. Reporting success first let the caller join a room on a connection the
    // server still considered anonymous, which then refused the account's own name as belonging to a registered
    // account, because from that connection's point of view it did.
    const signedIn = new Promise<void>(resolve => {
      service.login('Len', 'a password').subscribe(result => {
        events.push(result.ok ? 'reported success' : 'reported failure');
        resolve();
      });
    });

    http.expectOne(request => request.url.endsWith('login')).flush({
      id: 1, username: 'Len', approved: 1, userprivileges: 1
    });

    await signedIn;

    expect(events).toEqual(['connection replaced', 'reported success']);
  });

  it('knows who you are before the connection is replaced', () => {
    // So a caller reading the profile in its result handler sees it, which the login modal does.
    service.login('Len', 'a password').subscribe();

    http.expectOne(request => request.url.endsWith('login')).flush({
      id: 1, username: 'Len', approved: 1, userprivileges: 1
    });

    expect(service.user.value?.username).toBe('Len');
  });

  it('does not replace the connection when signing in fails', async () => {
    const finished = new Promise<void>(resolve => {
      service.login('Len', 'wrong').subscribe(result => {
        expect(result.ok).toBe(false);
        resolve();
      });
    });

    http.expectOne(request => request.url.endsWith('login'))
      .flush({ message: 'Username or password is incorrect' }, { status: 401, statusText: 'Unauthorized' });

    await finished;

    expect(events).toEqual([]);
    expect(service.user.value).toBeNull();
  });

  it('replaces the connection when signing out', async () => {
    // Clearing the cookie does not change the identity of a connection already open, so without this the hub
    // went on honouring calls with the privileges of the account that had just signed out.
    const signedOut = new Promise<void>(resolve => {
      service.logout().subscribe(() => resolve());
    });

    http.expectOne(request => request.url.endsWith('logout')).flush({});

    await signedOut;

    expect(events).toEqual(['connection replaced']);
    expect(service.user.value).toBeNull();
  });

  it('replaces the connection even when signing out fails', async () => {
    // A failed sign-out must not leave a privileged connection open.
    const finished = new Promise<void>(resolve => {
      service.logout().subscribe(result => {
        expect(result.ok).toBe(false);
        resolve();
      });
    });

    http.expectOne(request => request.url.endsWith('logout'))
      .flush({}, { status: 500, statusText: 'Server Error' });

    await finished;

    expect(events).toEqual(['connection replaced']);
    expect(service.user.value).toBeNull();
  });
});
