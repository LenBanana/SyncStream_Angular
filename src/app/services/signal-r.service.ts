import { Injectable } from '@angular/core';
import * as signalR from '@microsoft/signalr';
import { BehaviorSubject } from 'rxjs';
import { CreateRoomRequest, RoomSummary } from '../Interfaces/Room';
import { resolveApiBaseUrl } from '../core/api-origin';

export var CurrentPing: number = 0.5;

/**
 * API origin, derived from the page's hostname so the session cookie stays same-site.
 * Exported because much of the app builds URLs from it.
 */
export var baseUrl: string = resolveApiBaseUrl();

/**
 * Built eagerly, so it is never undefined.
 *
 * Constructing a HubConnection does not open anything, so there is no cost to doing it at module load.
 * It used to be created inside startConnection, which left a window where any service reaching for it
 * crashed with "cannot access property invoke of undefined" instead of simply failing to send. That
 * window was real: on a reload the admin view called the hub before the connection existed.
 *
 * Invoking before the connection is up now rejects the returned promise, which callers can handle, and
 * two components calling startConnection no longer build two connections and clobber this reference.
 */
export var hubConnection: signalR.HubConnection = new signalR.HubConnectionBuilder()
  // withCredentials sends the session cookie on the negotiate request and the socket handshake.
  // Anonymous connections are allowed: guests can watch without an account.
  .withUrl(baseUrl + 'server', { withCredentials: true })
  // Replaces a hand-rolled setTimeout loop. Retries at 0s, 2s, 10s, 30s, then gives up.
  .withAutomaticReconnect()
  .build();

/**
 * Logs a failed hub invocation instead of letting it kill the page.
 *
 * A hub invocation returns a promise, and the server now rejects one the caller is not allowed to make.
 * Under the old privilege aspect a refusal came back as a completed task, so denial was silent; an
 * unhandled rejection is a fatal zone error, which blanked the whole app for a signed-out visitor the
 * moment anything privileged was attempted.
 *
 * Attach this to fire-and-forget invocations. Calls whose result is actually used should handle their own
 * failure, since for those a refusal usually needs to be shown to the person.
 */
export function logHubFailure(error: unknown): undefined {
  // "Not allowed" and "something broke" are different things and were being logged identically. A refusal
  // is an expected answer for a guest, so it is informational; anything else is a genuine failure worth
  // noticing, and lumping the two together is how a real fault hides behind routine noise.
  if (isAuthorizationRefusal(error)) {
    console.info('Hub refused the call, which needs an account:', describeHubError(error));
    return undefined;
  }

  console.error('Hub invocation failed:', error);
  return undefined;
}

/** Whether the hub refused a call for lack of privilege, rather than failing. */
export function isAuthorizationRefusal(error: unknown): boolean {
  return /because user is unauthorized/i.test(describeHubError(error));
}

function describeHubError(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

@Injectable({
  providedIn: 'root'
})
export class SignalRService {
  room: BehaviorSubject<RoomSummary[]> = new BehaviorSubject([]);

  /**
   * False while the connection is usable, true while it is not.
   *
   * Feature services key their handler registration off this: they add handlers on false and remove
   * them on true. It must therefore go true before it goes false again, or `.on()` would stack a second
   * handler onto the same event and every message would arrive twice.
   */
  connectionClosed: BehaviorSubject<boolean> = new BehaviorSubject(null);

  /**
   * Round trips in seconds, as measured.
   *
   * Starts empty rather than on CurrentPing's initial value: the latency estimate takes the smallest sample it
   * has seen, so a made-up figure published before anything was measured would stand as the estimate for as
   * long as it undercut the real round trips.
   */
  pingStream: BehaviorSubject<number> = new BehaviorSubject(null);

  private lifecycleWired = false;

  public async startConnection() {
    this.wireLifecycle();
    await this.connect();
  }

  private wireLifecycle() {
    if (this.lifecycleWired) {
      return;
    }
    this.lifecycleWired = true;

    hubConnection.onreconnecting(() => {
      console.log('Connection lost, reconnecting');
      this.connectionClosed.next(true);
    });

    hubConnection.onreconnected(() => {
      console.log('Reconnected');
      this.connectionClosed.next(false);
    });

    hubConnection.onclose(() => {
      // Reached only once automatic reconnect has exhausted its attempts.
      console.log('Connection closed, retrying from scratch');
      this.connectionClosed.next(true);
      setTimeout(() => this.connect(), 5000);
    });
  }

  public async connect() {
    // Called from more than one component, and again by the retry paths, so only start when idle.
    if (hubConnection.state !== signalR.HubConnectionState.Disconnected) {
      if (hubConnection.state === signalR.HubConnectionState.Connected) {
        this.connectionClosed.next(false);
      }
      return;
    }

    try {
      await hubConnection.start();
      console.log('Connection started');
      this.addRoomListener();
      this.AddPingListener();
      this.connectionClosed.next(false);
    } catch (error) {
      console.log('Error while starting connection: ' + error + ', retrying');
      setTimeout(() => this.connect(), 2000);
    }
  }

  public async stopConnection() {
    try {
      await hubConnection.stop();
      console.log('Connection stopped');
    } catch (error) {
      console.log('Error while stopping connection: ' + error);
    }
  }

  public addRoomListener() {
    hubConnection.off('getrooms');
    hubConnection.on('getrooms', (data) => {
      this.room.next(data);
    });
  }

  public removeRoomListener() {
    hubConnection.off('getrooms');
    this.room.next(null);
  }

  public addRoom(room: CreateRoomRequest) {
    hubConnection.invoke('AddRoom', room).catch(logHubFailure);
  }

  public removeRoom(UniqueId: string) {
    hubConnection.invoke('RemoveRoom', UniqueId).catch(logHubFailure);
  }

  public AddPingListener() {
    hubConnection.off('PingTest');
    hubConnection.on('PingTest', (date: Date) => {
      let diff = new Date().getTime() - new Date(date).getTime();
      CurrentPing = (diff / 1000);
      this.pingStream.next(CurrentPing);
    });
  }

  public RemovePingListener() {
    hubConnection.off('PingTest');
  }
}
