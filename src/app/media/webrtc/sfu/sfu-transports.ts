import {BehaviorSubject} from 'rxjs';
import {types} from 'mediasoup-client';
import {HubConnectionState} from '@microsoft/signalr';
import {hubConnection, logHubFailure} from '../../../services/signal-r.service';
import {withoutScalabilityModes} from './sfu-encodings';

/** Matches SfuTransportInfo on the server. */
interface SfuTransportInfo {
  id: string;
  iceParameters: types.IceParameters;
  iceCandidates: types.IceCandidate[];
  dtlsParameters: types.DtlsParameters;
}

/** Matches SfuConsumerInfo on the server. */
interface SfuConsumerInfo {
  id: string;
  producerId: string;
  kind: types.MediaKind;
  rtpParameters: types.RtpParameters;
}

/** Matches SfuProducerEntry on the server. */
export interface SfuProducerEntry {
  id: string;
  kind: types.MediaKind;
  peerId: string;
}

/** Matches SfuNewProducerNotification on the server. */
export interface SfuNewProducerNotification {
  producerId: string;
  peerId: string;
  kind: types.MediaKind;
  roomId: string;
}

/** Matches SfuTransportDirection on the server. */
enum SfuTransportDirection {
  Send = 0,
  Recv = 1
}

/**
 * Where a link to the SFU stands. "reconnecting" covers both a connection that dropped and is being given a moment,
 * and one being rebuilt; "failed" means every attempt to recover was used up.
 */
export type SfuLinkState = 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'closed';

const DISCONNECTED_GRACE_MS = 4000;
const ICE_RESTART_WAIT_MS = 6000;
const REBUILD_DELAYS_MS = [500, 2000, 5000, 10000];

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * One transport to the SFU and the way it recovers.
 *
 * Nothing used to watch a transport at all, so a viewer whose connection failed sat on a frozen frame until they
 * reloaded, and a streamer whose connection failed kept streaming to nobody. A transport that drops is given a few
 * seconds, then its ICE is restarted, and if that does not bring it back the whole link is rebuilt: new transport,
 * same SFU room, same tracks.
 */
abstract class SfuLink {
  readonly state = new BehaviorSubject<SfuLinkState>('connecting');
  protected transport: types.Transport | null = null;
  protected closed = false;
  private recovering = false;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;

  protected constructor(readonly sfuRoomId: string, protected readonly loadDevice: () => Promise<types.Device>) {
  }

  /** Starts watching a newly created transport. */
  protected watch(transport: types.Transport): void {
    transport.on('connectionstatechange', connectionState => {
      if (transport !== this.transport || this.closed) return;

      if (connectionState === 'connected') {
        this.clearDisconnectTimer();
        this.state.next('connected');
      } else if (connectionState === 'disconnected') {
        // Often recovers by itself, for instance across a brief Wi-Fi drop.
        this.state.next('reconnecting');
        this.clearDisconnectTimer();
        this.disconnectTimer = setTimeout(() => void this.recover(), DISCONNECTED_GRACE_MS);
      } else if (connectionState === 'failed') {
        void this.recover();
      }
    });
  }

  /** Rebuilds the link from scratch, as after a failed transport. */
  async reconnect(): Promise<void> {
    await this.recover(true);
  }

  private async recover(skipIceRestart = false): Promise<void> {
    if (this.recovering || this.closed) return;
    this.recovering = true;
    this.clearDisconnectTimer();
    this.state.next('reconnecting');

    try {
      const transport = this.transport;
      if (!skipIceRestart && transport && !transport.closed) {
        try {
          const iceParameters = await hubConnection.invoke<types.IceParameters>(
            'RestartSfuIce', this.sfuRoomId, transport.id);
          await transport.restartIce({iceParameters});
          if (await this.waitForConnected(transport, ICE_RESTART_WAIT_MS)) return;
        } catch (err) {
          console.warn(`[SFU] ICE restart failed in ${this.sfuRoomId}, rebuilding`, err);
        }
      }

      for (const delay of REBUILD_DELAYS_MS) {
        if (this.closed) return;
        try {
          await this.rebuild();
          return;
        } catch (err) {
          console.warn(`[SFU] rebuilding ${this.sfuRoomId} failed, next try in ${delay} ms`, err);
          await sleep(delay);
        }
      }
      if (!this.closed) this.state.next('failed');
    } finally {
      this.recovering = false;
    }
  }

  private waitForConnected(transport: types.Transport, timeoutMs: number): Promise<boolean> {
    if (transport.connectionState === 'connected') return Promise.resolve(true);
    return new Promise(resolve => {
      const onState = (connectionState: types.ConnectionState) => {
        if (connectionState !== 'connected') return;
        clearTimeout(timer);
        transport.removeListener('connectionstatechange', onState);
        resolve(true);
      };
      const timer = setTimeout(() => {
        transport.removeListener('connectionstatechange', onState);
        resolve(false);
      }, timeoutMs);
      transport.on('connectionstatechange', onState);
    });
  }

  private clearDisconnectTimer(): void {
    if (this.disconnectTimer !== null) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
  }

  /** Creates a transport of the given direction in the SFU room and wires up its DTLS handshake. */
  protected async createTransport(device: types.Device, direction: SfuTransportDirection): Promise<types.Transport> {
    const info = await hubConnection.invoke<SfuTransportInfo>('CreateWebRtcTransport', this.sfuRoomId, direction);
    const options: types.TransportOptions = {
      id: info.id,
      iceParameters: info.iceParameters,
      iceCandidates: info.iceCandidates,
      dtlsParameters: info.dtlsParameters
    };
    const transport = direction === SfuTransportDirection.Send
      ? device.createSendTransport(options)
      : device.createRecvTransport(options);

    transport.on('connect', ({dtlsParameters}, callback, errback) => {
      hubConnection.invoke('ConnectTransport', this.sfuRoomId, transport.id, dtlsParameters)
        .then(() => callback(), errback);
    });
    return transport;
  }

  /** Closes the link for good and gives up its place in the SFU room. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.clearDisconnectTimer();
    this.closeLocally();
    this.state.next('closed');
    // A dropped connection has already released everything on the server.
    if (hubConnection.state === HubConnectionState.Connected) {
      await hubConnection.invoke('LeaveSfuRoom', this.sfuRoomId).catch(logHubFailure);
    }
  }

  /** Re-creates everything from scratch: the old transport is gone on both ends first. */
  private async rebuild(): Promise<void> {
    this.closeLocally();
    await hubConnection.invoke('LeaveSfuRoom', this.sfuRoomId);
    await this.open();
  }

  /** Joins the SFU room and creates the transport; the first time, and again after a rebuild. */
  abstract open(): Promise<void>;

  /** Closes this end's transport and everything on it, without telling the server. */
  protected abstract closeLocally(): void;
}

/** Sends tracks into one SFU room. */
export class SfuSender extends SfuLink {
  private readonly producers = new Map<string, {producer: types.Producer; options: types.ProducerOptions}>();

  constructor(sfuRoomId: string, loadDevice: () => Promise<types.Device>) {
    super(sfuRoomId, loadDevice);
  }

  async open(): Promise<void> {
    const device = await this.loadDevice();
    await hubConnection.invoke<SfuProducerEntry[]>('JoinSfuRoom', this.sfuRoomId);
    const transport = await this.createTransport(device, SfuTransportDirection.Send);
    transport.on('produce', ({kind, rtpParameters}, callback, errback) => {
      hubConnection.invoke<string>('Produce', this.sfuRoomId, transport.id, kind, rtpParameters)
        .then(id => callback({id}), errback);
    });
    this.transport = transport;
    this.watch(transport);

    // After a rebuild, send again what was being sent.
    for (const [key, entry] of [...this.producers]) {
      this.producers.delete(key);
      if (entry.options.track?.readyState === 'live') {
        await this.produce(key, entry.options, entry.producer.paused);
      }
    }
  }

  /**
   * Sends a track under a key ("audio", "video"), replacing whatever was sent under that key. A browser that
   * refuses the encodings' scalability modes gets the same layers without them.
   */
  async produce(key: string, options: types.ProducerOptions, paused = false): Promise<types.Producer> {
    if (!this.transport || this.transport.closed) throw new Error('The send transport is not open');
    const existing = this.producers.get(key);
    if (existing) await this.remove(key);

    const settled: types.ProducerOptions = {...options, stopTracks: false, disableTrackOnPause: false, zeroRtpOnPause: true};
    let producer: types.Producer;
    try {
      producer = await this.transport.produce(settled);
    } catch (err) {
      const fallback = withoutScalabilityModes(settled);
      if (fallback === settled) throw err;
      console.warn('[SFU] producing with scalability modes failed, retrying without them', err);
      producer = await this.transport.produce(fallback);
    }

    if (paused) producer.pause();
    this.producers.set(key, {producer, options: settled});
    return producer;
  }

  async replaceTrack(key: string, track: MediaStreamTrack): Promise<void> {
    const entry = this.producers.get(key);
    if (!entry) throw new Error(`Nothing is being sent as ${key}`);
    await entry.producer.replaceTrack({track});
    entry.options = {...entry.options, track};
  }

  /** Stops sending one track; the track itself keeps running. */
  async remove(key: string): Promise<void> {
    const entry = this.producers.get(key);
    if (!entry) return;
    this.producers.delete(key);
    entry.producer.close();
    await hubConnection.invoke('CloseProducer', this.sfuRoomId, entry.producer.id);
  }

  /** Mutes or unmutes one track: a paused producer sends nothing at all. */
  setPaused(key: string, paused: boolean): void {
    const producer = this.producers.get(key)?.producer;
    if (!producer) return;
    if (paused) producer.pause();
    else producer.resume();
  }

  has(key: string): boolean {
    return this.producers.has(key);
  }

  protected closeLocally(): void {
    this.producers.forEach(({producer}) => producer.close());
    this.transport?.close();
    this.transport = null;
  }

  override async close(): Promise<void> {
    await super.close();
    this.producers.clear();
  }
}

/** A track received from someone in an SFU room. */
export interface ReceivedTrack {
  producerId: string;
  /** The sender's connection id, or "server-file:…" for a file the server is streaming. */
  peerId: string;
  track: MediaStreamTrack;
}

/** Receives every track in one SFU room. */
export class SfuReceiver extends SfuLink {
  readonly tracks = new BehaviorSubject<ReceivedTrack[]>([]);
  private readonly consumers = new Map<string, {consumer: types.Consumer; peerId: string}>();
  /** Producers known to exist and not consumed yet, with who sends them. */
  private readonly pending = new Map<string, string>();
  private readonly consuming = new Set<string>();
  private device: types.Device | null = null;

  constructor(sfuRoomId: string, loadDevice: () => Promise<types.Device>, private readonly onClose: (receiver: SfuReceiver) => void) {
    super(sfuRoomId, loadDevice);
  }

  async open(): Promise<void> {
    this.device = await this.loadDevice();
    // Producers announced from here on arrive as notifications; the ones before are in the list. Both are queued
    // until the transport exists, so neither is lost to the gap between joining and creating it.
    const existing = await hubConnection.invoke<SfuProducerEntry[]>('JoinSfuRoom', this.sfuRoomId);
    existing.forEach(entry => this.pending.set(entry.id, entry.peerId));
    const transport = await this.createTransport(this.device, SfuTransportDirection.Recv);
    this.transport = transport;
    this.watch(transport);
    await this.consumePending();
  }

  /** A producer was announced in this room. */
  producerAdded(notification: SfuNewProducerNotification): void {
    if (this.closed) return;
    this.pending.set(notification.producerId, notification.peerId);
    if (this.transport) void this.consumePending();
  }

  /** A producer in this room was closed. */
  producerClosed(producerId: string): void {
    this.pending.delete(producerId);
    const entry = this.consumers.get(producerId);
    if (!entry) return;
    this.consumers.delete(producerId);
    entry.consumer.close();
    this.publish();
  }

  private async consumePending(): Promise<void> {
    const transport = this.transport;
    const device = this.device;
    if (!transport || !device) return;

    for (const [producerId, peerId] of [...this.pending]) {
      if (this.consumers.has(producerId) || this.consuming.has(producerId)) continue;
      this.pending.delete(producerId);
      this.consuming.add(producerId);
      try {
        const info = await hubConnection.invoke<SfuConsumerInfo>(
          'Consume', this.sfuRoomId, transport.id, producerId, device.rtpCapabilities);
        if (transport !== this.transport || this.closed) continue;
        const consumer = await transport.consume({
          id: info.id,
          producerId: info.producerId,
          kind: info.kind,
          rtpParameters: info.rtpParameters
        });
        consumer.on('trackended', () => this.producerClosed(producerId));
        this.consumers.set(producerId, {consumer, peerId});
        this.publish();
      } catch (err) {
        console.error(`[SFU] could not receive producer ${producerId} in ${this.sfuRoomId}`, err);
      } finally {
        this.consuming.delete(producerId);
      }
    }
  }

  private publish(): void {
    this.tracks.next([...this.consumers.entries()].map(([producerId, {consumer, peerId}]) =>
      ({producerId, peerId, track: consumer.track})));
  }

  protected closeLocally(): void {
    this.consumers.forEach(({consumer}) => consumer.close());
    this.consumers.clear();
    this.consuming.clear();
    // Whatever is still in the room comes back with the next join.
    this.pending.clear();
    this.transport?.close();
    this.transport = null;
    this.publish();
  }

  override async close(): Promise<void> {
    this.pending.clear();
    await super.close();
    this.onClose(this);
  }
}
