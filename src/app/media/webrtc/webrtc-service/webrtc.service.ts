import {Injectable, OnDestroy} from '@angular/core';
import {BehaviorSubject, Subject} from 'rxjs';
import {SignalRService, hubConnection, baseUrl} from '../../../services/signal-r.service';
import {token} from '../../../global.settings';
import {HttpClient} from "@angular/common/http";
import * as mediasoupClient from 'mediasoup-client';

@Injectable({
  providedIn: 'root'
})
export class WebrtcService implements OnDestroy {
  // Emits the streamer's connectionId when a stream starts; null when none.
  streamStart: BehaviorSubject<string> = new BehaviorSubject(null);
  // Emits the streamer's connectionId when a stream stops; null after cleared.
  streamStop: BehaviorSubject<string> = new BehaviorSubject(null);
  // Emits the incoming MediaStream once the viewer receives the first video/audio track.
  remoteStream: BehaviorSubject<MediaStream> = new BehaviorSubject(null);
  // Emits the incoming P2P MediaStream for the Discord-style popout viewer.
  popoutStream: BehaviorSubject<MediaStream | null> = new BehaviorSubject<MediaStream | null>(null);
  // Emits when the user wants to watch a specific P2P streamer (drives popout visibility).
  watchRequest: BehaviorSubject<{streamerId: string; username: string; roomId: string} | null> =
    new BehaviorSubject<{streamerId: string; username: string; roomId: string} | null>(null);
  // True while the viewer has moved the stream into the browser's Picture-in-Picture window.
  pipActive: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);

  // ---------- Streamer state (P2P) ----------
  private localStream: MediaStream | null = null;
  /** One RTCPeerConnection per viewer (keyed by viewer connectionId). */
  private viewerConnections: Map<string, RTCPeerConnection> = new Map();
  /** ICE candidates buffered before remote description is set for a viewer. */
  private viewerCandidateBuffer: Map<string, RTCIceCandidate[]> = new Map();
  /** Max bitrate (bps) requested by the streamer; 0 = unconstrained. */
  private localStreamMaxBitrate = 0;
  /** True when the current live screen-share session is using the SFU path rather than P2P. */
  private liveStreamUsesSfu = false;

  // ---------- Viewer state (P2P) ----------
  private streamerPc: RTCPeerConnection | null = null;
  private streamerCandidateBuffer: RTCIceCandidate[] = [];
  private currentRoomId: string | null = null;
  /** The connectionId of the streamer currently being watched (opt-in, Discord-style). */
  private currentViewingStreamerId: string | null = null;
  /** Guard that prevents two concurrent handleIncomingOffer calls from racing. */
  private incomingOfferInProgress = false;

  // ---------- SFU state ----------
  private sfuDevice: mediasoupClient.types.Device | null = null;
  private sfuSendTransport: mediasoupClient.types.Transport | null = null;
  private sfuRecvTransport: mediasoupClient.types.Transport | null = null;
  private sfuProducers: Map<string, mediasoupClient.types.Producer> = new Map();
  private sfuConsumers: Map<string, mediasoupClient.types.Consumer> = new Map();
  private sfuRoomId: string | null = null;
  private watchSfuRecvTransport: mediasoupClient.types.Transport | null = null;
  private watchSfuConsumers: Map<string, mediasoupClient.types.Consumer> = new Map();
  private watchSfuRoomId: string | null = null;
  private readonly rtcDebugStatsEnabled = false;
  private rtcDebugStatsTimer: number | null = null;
  private rtcDebugStatsSamples: Map<string, {bytes: number; timestampMs: number; frames?: number; freezes?: number}> = new Map();

  // ---------- File-share state ----------
  /** Emits info about who is sharing a file; null when no share is active. */
  public fileShareActive: BehaviorSubject<{streamerId: string; username: string} | null> =
    new BehaviorSubject<{streamerId: string; username: string} | null>(null);
  /** True when the file-share host has paused playback (used by viewer overlay). */
  public fileShareIsPaused: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  /** True when this client is the one sharing the file (local flag only). */
  public isFileShareHost: boolean = false;
  /** True while this client has opened the host file-share UI but has not finished starting the share yet. */
  public isPreparingFileShareHost: boolean = false;
  /** File selected in the side-nav and waiting for the host player to start streaming it. */
  public pendingFileShareFile: BehaviorSubject<File | null> = new BehaviorSubject<File | null>(null);
  /** True while the local host is stopping a file share through the explicit stop path. */
  private fileShareStopInProgress = false;
  /**
   * Fires when the local user (who is the room host / an Approved member) clicks
   * "Share File" in the side-nav. Media component listens and switches the player
   * to FileShare mode so the self-contained FileSharePlayerComponent can render.
   */
  public fileShareHostRequested: Subject<void> = new Subject<void>();
  /** Whether the SFU is available (checked once per session). */
  public sfuAvailable: boolean = false;
  /** Emits recording info when a recording starts, null when it stops. */
  public sfuRecording: BehaviorSubject<SfuRecordingInfo | null> = new BehaviorSubject<SfuRecordingInfo | null>(null);

  public requestFileShareHostUi(file?: File): void {
    if (this.fileShareActive.value) return;
    this.isPreparingFileShareHost = true;
    if (file) {
      this.pendingFileShareFile.next(file);
    }
    this.fileShareHostRequested.next();
  }

  public clearPendingFileShareFile(): void {
    this.pendingFileShareFile.next(null);
  }

  // ---------- Credential cache ----------
  private cachedCredentials: WebRtcCredentials | null = null;
  private credentialExpiry = 0;

  constructor(private http: HttpClient, private signalRService: SignalRService) {
    signalRService.connectionClosed.subscribe(isClosed => {
      if (isClosed === false) {
        this.addListeners();
      }
      if (isClosed === true) {
        this.removeListeners();
        this.cleanUpAll();
      }
    });
  }

  ngOnDestroy(): void {
    this.removeListeners();
    this.cleanUpAll();
  }

  // ================================================================
  // Configuration
  // ================================================================

  public async getWebRtcConfig(): Promise<RTCConfiguration> {
    const credentials = await this.getCredentialsCached();
    return {
      iceServers: [
        {urls: credentials.stunServer},
        {urls: credentials.turnServer, username: credentials.username, credential: credentials.password}
      ],
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    };
  }

  private async getCredentialsCached(): Promise<WebRtcCredentials> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (this.cachedCredentials && nowSeconds < this.credentialExpiry - 60) {
      return this.cachedCredentials;
    }
    const fresh = await this.GetWebRtcCredentials().toPromise();
    this.cachedCredentials = fresh;
    this.credentialExpiry = parseInt(fresh.username, 10);
    return fresh;
  }

  public invalidateCredentials(): void {
    this.cachedCredentials = null;
    this.credentialExpiry = 0;
  }

  private GetWebRtcCredentials() {
    if (token) {
      return this.http.get<WebRtcCredentials>(baseUrl + 'api/webrtc/GetWebRtcCredentials?token=' + token);
    }
  }

  // ================================================================
  // SFU availability
  // ================================================================

  public async checkSfuAvailable(): Promise<boolean> {
    if (!token) return false;
    try {
      this.sfuAvailable = await hubConnection.invoke<boolean>('IsSfuAvailable', token);
    } catch {
      this.sfuAvailable = false;
    }
    return this.sfuAvailable;
  }

  private buildOptInLiveSfuRoomId(roomId: string, streamerId: string): string {
    return `live-watch:${roomId}:${streamerId}`;
  }

  private hasActiveRtcStatsTargets(): boolean {
    return this.sfuProducers.size > 0 || this.sfuConsumers.size > 0 || this.watchSfuConsumers.size > 0;
  }

  private ensureRtcDebugStatsPolling(): void {
    if (!this.rtcDebugStatsEnabled || this.rtcDebugStatsTimer !== null) return;
    this.rtcDebugStatsTimer = window.setInterval(() => {
      void this.logActiveRtcStats();
    }, 5000);
  }

  private maybeStopRtcDebugStatsPolling(): void {
    if (this.hasActiveRtcStatsTargets()) return;
    if (this.rtcDebugStatsTimer !== null) {
      window.clearInterval(this.rtcDebugStatsTimer);
      this.rtcDebugStatsTimer = null;
    }
    this.rtcDebugStatsSamples.clear();
  }

  private async logActiveRtcStats(): Promise<void> {
    if (!this.hasActiveRtcStatsTargets()) {
      this.maybeStopRtcDebugStatsPolling();
      return;
    }

    const summaries: Array<{label: string; data: unknown}> = [];

    for (const [producerId, producer] of this.sfuProducers) {
      const summary = await this.summarizeProducerStats(producerId, producer);
      if (summary) summaries.push(summary);
    }

    for (const [consumerId, consumer] of this.sfuConsumers) {
      const summary = await this.summarizeConsumerStats(`viewer:${consumerId}`, consumer);
      if (summary) summaries.push(summary);
    }

    for (const [consumerId, consumer] of this.watchSfuConsumers) {
      const summary = await this.summarizeConsumerStats(`watch:${consumerId}`, consumer);
      if (summary) summaries.push(summary);
    }

    if (summaries.length === 0) return;

    console.groupCollapsed(`[WebRTC Stats] ${new Date().toLocaleTimeString()} (${summaries.length})`);
    for (const summary of summaries) {
      console.info(summary.label, summary.data);
    }
    console.groupEnd();
  }

  private computeBitrateBps(key: string, bytes: number, timestampMs: number, frames?: number, freezes?: number): {
    bitrateBps: number | null;
    framesDelta: number | null;
    freezesDelta: number | null;
  } {
    const previous = this.rtcDebugStatsSamples.get(key);
    this.rtcDebugStatsSamples.set(key, {bytes, timestampMs, frames, freezes});
    if (!previous || timestampMs <= previous.timestampMs) {
      return {bitrateBps: null, framesDelta: null, freezesDelta: null};
    }

    const elapsedMs = timestampMs - previous.timestampMs;
    const bitrateBps = Math.max(0, ((bytes - previous.bytes) * 8 * 1000) / elapsedMs);
    const framesDelta = frames !== undefined && previous.frames !== undefined ? frames - previous.frames : null;
    const freezesDelta = freezes !== undefined && previous.freezes !== undefined ? freezes - previous.freezes : null;
    return {bitrateBps, framesDelta, freezesDelta};
  }

  private formatBitrateMbps(bitrateBps: number | null | undefined): string | null {
    if (!bitrateBps || bitrateBps <= 0) return null;
    return `${(bitrateBps / 1_000_000).toFixed(2)} Mbps`;
  }

  private async summarizeProducerStats(
    producerId: string,
    producer: mediasoupClient.types.Producer
  ): Promise<{label: string; data: unknown} | null> {
    try {
      const report = await producer.getStats();
      let outbound: any = null;
      let track: any = null;

      report.forEach((stat: any) => {
        if (stat.type === 'outbound-rtp' && !stat.isRemote && stat.kind === 'video') outbound = stat;
        if (stat.type === 'track' && stat.kind === 'video') track = stat;
      });

      if (!outbound) return null;

      const sample = this.computeBitrateBps(
        `producer:${producerId}`,
        outbound.bytesSent ?? 0,
        outbound.timestamp ?? Date.now(),
        outbound.framesEncoded,
        undefined
      );

      return {
        label: `SFU sender ${producerId}`,
        data: {
          resolution: `${outbound.frameWidth ?? track?.frameWidth ?? '?'}x${outbound.frameHeight ?? track?.frameHeight ?? '?'}`,
          fps: outbound.framesPerSecond ?? track?.framesPerSecond ?? null,
          bitrate: this.formatBitrateMbps(sample.bitrateBps),
          framesEncodedDelta: sample.framesDelta,
          qualityLimitationReason: outbound.qualityLimitationReason ?? null,
          qualityLimitationDurations: outbound.qualityLimitationDurations ?? null,
          nackCount: outbound.nackCount ?? null,
          pliCount: outbound.pliCount ?? null,
          firCount: outbound.firCount ?? null,
          retransmittedPacketsSent: outbound.retransmittedPacketsSent ?? null,
          encoderImplementation: outbound.encoderImplementation ?? null
        }
      };
    } catch (err) {
      console.warn('Producer stats read failed', producerId, err);
      return null;
    }
  }

  private async summarizeConsumerStats(
    statsKey: string,
    consumer: mediasoupClient.types.Consumer
  ): Promise<{label: string; data: unknown} | null> {
    try {
      const report = await consumer.getStats();
      let inbound: any = null;
      let track: any = null;

      report.forEach((stat: any) => {
        if (stat.type === 'inbound-rtp' && !stat.isRemote && stat.kind === 'video') inbound = stat;
        if (stat.type === 'track' && stat.kind === 'video') track = stat;
      });

      if (!inbound) return null;

      const sample = this.computeBitrateBps(
        `consumer:${statsKey}`,
        inbound.bytesReceived ?? 0,
        inbound.timestamp ?? Date.now(),
        inbound.framesDecoded,
        inbound.freezeCount ?? track?.freezeCount
      );
      const framesDropped = inbound.framesDropped ?? track?.framesDropped ?? 0;
      const freezeCount = inbound.freezeCount ?? track?.freezeCount ?? 0;
      const fps = inbound.framesPerSecond ?? track?.framesPerSecond ?? null;
      const jitterMs = inbound.jitter !== undefined ? Math.round(inbound.jitter * 1000) : null;

      return {
        label: `SFU receiver ${statsKey}`,
        data: {
          resolution: `${inbound.frameWidth ?? track?.frameWidth ?? '?'}x${inbound.frameHeight ?? track?.frameHeight ?? '?'}`,
          fps,
          bitrate: this.formatBitrateMbps(sample.bitrateBps),
          framesDecodedDelta: sample.framesDelta,
          framesDropped,
          freezeCount,
          freezeDelta: sample.freezesDelta,
          totalFreezesDuration: inbound.totalFreezesDuration ?? track?.totalFreezesDuration ?? null,
          packetsLost: inbound.packetsLost ?? null,
          jitterMs,
          nackCount: inbound.nackCount ?? null,
          pliCount: inbound.pliCount ?? null,
          decoderImplementation: inbound.decoderImplementation ?? null
        }
      };
    } catch (err) {
      console.warn('Consumer stats read failed', statsKey, err);
      return null;
    }
  }

  private isDisplayTrack(track: MediaStreamTrack): boolean {
    const settings = track.getSettings() as MediaTrackSettings & {displaySurface?: string};
    return track.kind === 'video' && typeof settings.displaySurface === 'string' && settings.displaySurface.length > 0;
  }

  private buildDisplayEncodings(
    track: MediaStreamTrack,
    topBitrate: number,
    preferredResolution?: number
  ): {
    encodings: mediasoupClient.types.ProducerCodecOptions[] | mediasoupClient.types.ProducerOptions['encodings'];
    sourceHeight: number;
    targetHeight: number;
  } {
    const settings = track.getSettings();
    const sourceHeight = typeof settings.height === 'number' && settings.height > 0
      ? settings.height
      : (preferredResolution && preferredResolution > 0 ? preferredResolution : 1080);
    const targetHeight = preferredResolution && preferredResolution > 0
      ? Math.min(preferredResolution, sourceHeight)
      : sourceHeight;
    const highScale = Math.max(1, sourceHeight / targetHeight);
    const lowScale = Math.max(highScale, highScale * 2);

    return {
      encodings: [
        {
          maxBitrate: Math.max(600_000, Math.round(topBitrate / 3)),
          scaleResolutionDownBy: Number(lowScale.toFixed(2))
        },
        {
          maxBitrate: topBitrate,
          scaleResolutionDownBy: Number(highScale.toFixed(2))
        }
      ],
      sourceHeight,
      targetHeight
    };
  }

  private buildVideoProducerOptions(
    track: MediaStreamTrack,
    maxBitrate?: number,
    preferredResolution?: number,
    profile: 'default' | 'file-share' = 'default'
  ): mediasoupClient.types.ProducerOptions {
    const topBitrate = maxBitrate && maxBitrate > 0 ? maxBitrate : 6_000_000;
    const isDisplay = this.isDisplayTrack(track);

    try {
      track.contentHint = isDisplay ? 'detail' : 'motion';
    } catch {
      // Best-effort only.
    }

    const produceOptions: mediasoupClient.types.ProducerOptions = {
      track,
      codecOptions: {videoGoogleStartBitrate: Math.max(1000, Math.round(topBitrate / 1000))}
    };

    if (profile === 'file-share') {
      produceOptions.encodings = [
        {maxBitrate: topBitrate}
      ];
    } else if (isDisplay) {
      if (preferredResolution && preferredResolution > 0) {
        const displayEncodingProfile = this.buildDisplayEncodings(track, topBitrate, preferredResolution);
        produceOptions.encodings = displayEncodingProfile.encodings as any;
      } else {
        produceOptions.encodings = [
          {maxBitrate: topBitrate}
        ];
      }
    } else {
      produceOptions.encodings = [
        {maxBitrate: Math.round(topBitrate / 20), scaleResolutionDownBy: 4},
        {maxBitrate: Math.round(topBitrate / 4),  scaleResolutionDownBy: 2},
        {maxBitrate: topBitrate},
      ];
    }

    return produceOptions;
  }

  // ================================================================
  // SFU â€” Streamer API
  // ================================================================

  /**
   * Starts streaming via the SFU.  Falls back to P2P if SFU is not available.
   */
  public async startStreamingSfu(roomId: string, stream: MediaStream, maxBitrate?: number, preferredResolution?: number): Promise<void> {
    if (!token) return;

    await this.ensureSfuDevice();
    this.sfuRoomId = roomId;
    this.localStream = stream;

    const existingProducers: SfuProducerEntry[] = await hubConnection.invoke<SfuProducerEntry[]>(
      'JoinSfuRoom', token, roomId
    );

    // Create a send transport.
    const transportInfo: SfuTransportInfo = await hubConnection.invoke<SfuTransportInfo>(
      'CreateWebRtcTransport', token, roomId, 0 /* Send = 0 */
    );
    this.sfuSendTransport = this.sfuDevice!.createSendTransport({
      id: transportInfo.id,
      iceParameters: transportInfo.iceParameters as any,
      iceCandidates: transportInfo.iceCandidates as any,
      dtlsParameters: transportInfo.dtlsParameters as any
    });

    this.sfuSendTransport.on('connect', async ({dtlsParameters}, callback, errback) => {
      try {
        await hubConnection.invoke('ConnectTransport', token, roomId, transportInfo.id, dtlsParameters);
        callback();
      } catch (err) {
        errback(err);
      }
    });

    this.sfuSendTransport.on('produce', async ({kind, rtpParameters, appData}, callback, errback) => {
      try {
        const producerId = await hubConnection.invoke<string>(
          'Produce', token, roomId, transportInfo.id, kind, rtpParameters
        );
        callback({id: producerId});
      } catch (err) {
        errback(err);
      }
    });

    // Produce each track from the local stream.
    for (const track of stream.getTracks()) {
      const produceOptions: mediasoupClient.types.ProducerOptions = track.kind === 'video'
        ? this.buildVideoProducerOptions(track, maxBitrate, preferredResolution)
        : {track};
      const producer = await this.sfuSendTransport.produce(produceOptions);
      this.sfuProducers.set(producer.id, producer);
    }
    this.ensureRtcDebugStatsPolling();

    // Notify the room that SFU streaming has started; late-joiners will auto-join.
    await hubConnection.invoke('StartSfuStream', token, roomId)
      .catch(err => console.error('StartSfuStream failed:', err));
  }

  /** Stop SFU streaming and tear down send transport + producers. */
  public async stopStreamingSfu(roomId: string): Promise<void> {
    if (!token) return;
    // Signal the room first so viewers get notified before transports close.
    await hubConnection.invoke('StopSfuStream', token, roomId)
      .catch(err => console.error('StopSfuStream failed:', err));
    for (const [id, producer] of this.sfuProducers) {
      try {
        await hubConnection.invoke('CloseProducer', token, roomId, id);
      } catch { /* best-effort */ }
      producer.close();
    }
    this.sfuProducers.clear();
    this.sfuSendTransport?.close();
    this.sfuSendTransport = null;
    await hubConnection.invoke('LeaveSfuRoom', token, roomId).catch(() => {});
    this.sfuRoomId = null;
    this.maybeStopRtcDebugStatsPolling();
  }

  /**
   * Starts an opt-in live screen-share over the SFU without switching the room's
   * main player or auto-joining viewers.
   */
  private async startOptInStreamingSfu(roomId: string, stream: MediaStream, maxBitrate?: number, preferredResolution?: number): Promise<void> {
    if (!token) return;
    const bitrate = maxBitrate ?? this.localStreamMaxBitrate;

    this.liveStreamUsesSfu = true;
    try {
      const liveRoomId = await hubConnection.invoke<string>('StartSfuOptInStream', token, roomId);
      if (!liveRoomId) {
        throw new Error('StartSfuOptInStream did not return a live room id.');
      }

      await this.startSfuSendTransportOnly(liveRoomId, stream, bitrate, preferredResolution);
    } catch (err) {
      this.liveStreamUsesSfu = false;
      const liveRoomId = this.sfuRoomId;
      for (const [id, producer] of this.sfuProducers) {
        if (liveRoomId) {
          try { await hubConnection.invoke('CloseProducer', token, liveRoomId, id); } catch { /* best-effort */ }
        }
        producer.close();
      }
      this.sfuProducers.clear();
      this.sfuSendTransport?.close();
      this.sfuSendTransport = null;
      if (liveRoomId) {
        await hubConnection.invoke('LeaveSfuRoom', token, liveRoomId).catch(() => {});
      }
      this.sfuRoomId = null;
      this.maybeStopRtcDebugStatsPolling();
      throw err;
    }
  }

  /** Stops the active opt-in live screen-share routed through the SFU. */
  private async stopOptInStreamingSfu(roomId: string): Promise<void> {
    if (!token) return;
    const liveRoomId = this.sfuRoomId;
    this.liveStreamUsesSfu = false;

    await hubConnection.invoke('StopSfuOptInStream', token, roomId)
      .catch(err => console.error('StopSfuOptInStream failed:', err));

    if (!liveRoomId) {
      return;
    }

    for (const [id, producer] of this.sfuProducers) {
      try { await hubConnection.invoke('CloseProducer', token, liveRoomId, id); } catch { /* best-effort */ }
      producer.close();
    }
    this.sfuProducers.clear();
    this.sfuSendTransport?.close();
    this.sfuSendTransport = null;
    await hubConnection.invoke('LeaveSfuRoom', token, liveRoomId).catch(() => {});
    this.sfuRoomId = null;
    this.cleanUpStreamerSide();
    this.maybeStopRtcDebugStatsPolling();
  }

  // ================================================================
  // SFU â€” Viewer API
  // ================================================================

  /** Joins an SFU room as a viewer and begins consuming all active producers. */
  public async joinStreamSfu(roomId: string): Promise<void> {
    if (!token) return;

    await this.ensureSfuDevice();
    this.sfuRoomId = roomId;
    this.currentRoomId = roomId;

    const existingProducers: SfuProducerEntry[] = await hubConnection.invoke<SfuProducerEntry[]>(
      'JoinSfuRoom', token, roomId
    );

    // Create a single recv transport for all consumers.
    const transportInfo: SfuTransportInfo = await hubConnection.invoke<SfuTransportInfo>(
      'CreateWebRtcTransport', token, roomId, 1 /* Recv = 1 */
    );
    this.sfuRecvTransport = this.sfuDevice!.createRecvTransport({
      id: transportInfo.id,
      iceParameters: transportInfo.iceParameters as any,
      iceCandidates: transportInfo.iceCandidates as any,
      dtlsParameters: transportInfo.dtlsParameters as any
    });

    this.sfuRecvTransport.on('connect', async ({dtlsParameters}, callback, errback) => {
      try {
        await hubConnection.invoke('ConnectTransport', token, roomId, transportInfo.id, dtlsParameters);
        callback();
      } catch (err) {
        errback(err);
      }
    });

    // Capture the local transport reference before entering the async loop so that
    // a concurrent second call to joinStreamSfu cannot overwrite this.sfuRecvTransport
    // and steal our reference mid-loop.
    const recvTransport = this.sfuRecvTransport;

    // Consume existing producers.
    for (const entry of existingProducers) {
      await this.consumeProducer(roomId, recvTransport, entry.id);
    }
    this.ensureRtcDebugStatsPolling();
  }

  /** Leave the SFU room and release all consumer resources. */
  public async leaveStreamSfu(): Promise<void> {
    if (!token || !this.sfuRoomId) return;
    this.sfuConsumers.forEach(c => c.close());
    this.sfuConsumers.clear();
    this.sfuRecvTransport?.close();
    this.sfuRecvTransport = null;
    await hubConnection.invoke('LeaveSfuRoom', token, this.sfuRoomId).catch(() => {});
    this.sfuRoomId = null;
    this.currentRoomId = null;
    this.remoteStream.next(null);
    this.maybeStopRtcDebugStatsPolling();
  }

  /** Consume a single producer on the given recv transport and merge into remoteStream.
   * Takes the transport object directly to avoid the shared-mutable-state race that
   * occurs when two concurrent joinStreamSfu calls overwrite this.sfuRecvTransport. */
  private async consumeProducer(
    roomId: string,
    transport: mediasoupClient.types.Transport,
    producerId: string
  ): Promise<void> {
    if (!token || !this.sfuDevice) return;
    try {
      const consumerInfo: SfuConsumerInfo = await hubConnection.invoke<SfuConsumerInfo>(
        'Consume', token, roomId, transport.id, producerId, this.sfuDevice.rtpCapabilities
      );
      const consumer = await transport.consume({
        id: consumerInfo.id,
        producerId: consumerInfo.producerId,
        kind: consumerInfo.kind as 'audio' | 'video',
        rtpParameters: consumerInfo.rtpParameters as any
      });
      this.sfuConsumers.set(consumer.id, consumer);
      this.ensureRtcDebugStatsPolling();

      // Merge the new track into the shared remoteStream.
      let stream = this.remoteStream.value ?? new MediaStream();
      stream.addTrack(consumer.track);
      this.remoteStream.next(stream);

      const removeTrack = () => {
        consumer.track.stop();
        stream.removeTrack(consumer.track);
        this.sfuConsumers.delete(consumer.id);
        this.remoteStream.next(stream.getTracks().length > 0 ? stream : null);
        this.maybeStopRtcDebugStatsPolling();
      };

      // transportclose fires when the whole transport is torn down.
      // Producer closure is handled via the sfuProducerClosed SignalR event below.
      consumer.on('transportclose', removeTrack);
    } catch (err) {
      console.error('Error consuming producer:', producerId, err);
    }
  }

  /** Consume a single producer into the opt-in live watcher popout stream. */
  private async consumeProducerToPopout(
    roomId: string,
    transport: mediasoupClient.types.Transport,
    producerId: string
  ): Promise<void> {
    if (!token || !this.sfuDevice) return;
    try {
      const consumerInfo: SfuConsumerInfo = await hubConnection.invoke<SfuConsumerInfo>(
        'Consume', token, roomId, transport.id, producerId, this.sfuDevice.rtpCapabilities
      );
      const consumer = await transport.consume({
        id: consumerInfo.id,
        producerId: consumerInfo.producerId,
        kind: consumerInfo.kind as 'audio' | 'video',
        rtpParameters: consumerInfo.rtpParameters as any
      });
      this.watchSfuConsumers.set(consumer.id, consumer);
      this.ensureRtcDebugStatsPolling();

      const stream = this.popoutStream.value ?? new MediaStream();
      stream.addTrack(consumer.track);
      this.popoutStream.next(stream);

      const removeTrack = () => {
        consumer.track.stop();
        stream.removeTrack(consumer.track);
        this.watchSfuConsumers.delete(consumer.id);
        this.popoutStream.next(stream.getTracks().length > 0 ? stream : null);
        this.maybeStopRtcDebugStatsPolling();
      };

      consumer.on('transportclose', removeTrack);
    } catch (err) {
      console.error('Error consuming popout producer:', producerId, err);
    }
  }

  /** Loads the mediasoup-client Device with the router's RTP capabilities. */
  private async ensureSfuDevice(): Promise<void> {
    if (this.sfuDevice?.loaded) return;
    if (!token) return;
    const rtpCapabilities = await hubConnection.invoke<object>('GetRouterRtpCapabilities', token);
    this.sfuDevice = new mediasoupClient.Device();
    await this.sfuDevice.load({routerRtpCapabilities: rtpCapabilities as any});
  }

  // ================================================================
  // Streamer API (P2P â€“ kept for backward compat / SFU fallback)
  // ================================================================

  /** Begin broadcasting via P2P. Use startStreamingSfu when SFU is available. */
  public async startStreaming(roomId: string, stream: MediaStream, maxBitrate?: number, preferredResolution?: number): Promise<void> {
    this.currentRoomId = roomId;
    this.localStream = stream;
    this.localStreamMaxBitrate = maxBitrate ?? 0;
    const canUseSfu = await this.checkSfuAvailable();
    if (canUseSfu) {
      await this.startOptInStreamingSfu(roomId, stream, maxBitrate, preferredResolution);
      return;
    }

    this.liveStreamUsesSfu = false;
    this.invalidateCredentials();
    if (token) {
      await hubConnection.invoke('StartWebRtcStream', token, roomId)
        .catch(err => console.error('StartWebRtcStream failed:', err));
    }
  }

  /** Stop P2P broadcasting and close all viewer connections. */
  public async stopStreaming(roomId: string): Promise<void> {
    if (this.liveStreamUsesSfu) {
      await this.stopOptInStreamingSfu(roomId);
      return;
    }

    if (token) {
      await hubConnection.invoke('StopWebRtcStream', token, roomId)
        .catch(err => console.error('StopWebRtcStream failed:', err));
    }
    this.cleanUpStreamerSide();
  }

  /**
   * Full cleanup when leaving a room — stops any active stream (streamer or viewer)
   * and releases all local media tracks so the OS capture indicator disappears.
   */
  public async leaveRoom(roomId: string): Promise<void> {
    // Stop P2P streaming (releases local capture tracks + notifies server).
    if (this.localStream) {
      await this.stopStreaming(roomId);
    }
    // Stop watching a P2P stream if one is active.
    if (this.currentViewingStreamerId) {
      this.stopWatching();
    }
    // Leave SFU room if we were consuming one.
    if (this.sfuRoomId) {
      await this.leaveStreamSfu();
    }
    // Belt-and-suspenders: stop any tracks that might still be running.
    this.localStream?.getTracks().forEach(t => t.stop());
    this.cleanUpAll();
  }

  private cleanUpStreamerSide(): void {
    this.viewerConnections.forEach(pc => pc.close());
    this.viewerConnections.clear();
    this.viewerCandidateBuffer.clear();
    this.localStream = null;
    this.localStreamMaxBitrate = 0;
    this.liveStreamUsesSfu = false;
  }

  private async createViewerPeerConnection(viewerId: string): Promise<RTCPeerConnection> {
    // Close and evict any existing connection for this viewer before creating a fresh one.
    const existing = this.viewerConnections.get(viewerId);
    if (existing) {
      existing.onicecandidate = null;
      existing.onconnectionstatechange = null;
      existing.close();
      this.viewerConnections.delete(viewerId);
      this.viewerCandidateBuffer.delete(viewerId);
    }

    const config = await this.getWebRtcConfig();
    const pc = new RTCPeerConnection(config);

    this.localStream?.getTracks().forEach(track => pc.addTrack(track, this.localStream!));

    pc.onicecandidate = event => {
      if (event.candidate && token) {
        hubConnection.invoke('SendIceCandidateToViewer', token, viewerId, event.candidate)
          .catch(err => console.error('Error sending ICE candidate to viewer:', err));
      }
    };

    pc.onconnectionstatechange = () => {
      // Apply bitrate limit once negotiation is fully complete — setParameters is
      // only valid after the initial offer/answer exchange has finished.
      if (pc.connectionState === 'connected' && this.localStreamMaxBitrate > 0) {
        pc.getSenders()
          .filter(s => s.track?.kind === 'video')
          .forEach(sender => {
            const p = sender.getParameters();
            if (p.encodings?.length) {
              p.encodings.forEach(e => { e.maxBitrate = this.localStreamMaxBitrate; });
              sender.setParameters(p).catch(e => console.warn('setParameters failed:', e));
            }
          });
      }
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.viewerConnections.delete(viewerId);
        this.viewerCandidateBuffer.delete(viewerId);
        pc.close();
      }
    };

    this.viewerConnections.set(viewerId, pc);
    return pc;
  }

  private async handleViewerJoined(viewerId: string): Promise<void> {
    if (!this.localStream) return;
    try {
      const pc = await this.createViewerPeerConnection(viewerId);
      const rawOffer = await pc.createOffer();
      // Deduplicate RTP header extension IDs so the receiving Chrome does not
      // reject the SDP with "RTP extension ID reassignment" when audio and video
      // m-sections share the same ext-map ID for different extensions (e.g.
      // abs-send-time and csrc-audio-level both at ID 2 in a BUNDLE group).
      const fixedSdp = this.deduplicateExtmapIds(rawOffer.sdp ?? '');
      const bitratedSdp = this.injectBitrateIntoSdp(fixedSdp, this.localStreamMaxBitrate);
      const fixedOffer = new RTCSessionDescription({type: rawOffer.type, sdp: bitratedSdp});
      await pc.setLocalDescription(fixedOffer);
      if (token) {
        await hubConnection.invoke('SendOfferToViewer', token, viewerId, {
          type: pc.localDescription!.type,
          sdp: pc.localDescription!.sdp,
          roomId: this.currentRoomId   // let auto-joined viewers know which room they're in
        });
      }
    } catch (err) {
      console.error('Error creating offer for viewer:', err);
    }
  }

  /**
   * Injects `b=AS` (kbps) and `b=TIAS` (bps) bandwidth annotations into the
   * video m-section of an SDP offer so the remote peer's decoder and Chrome's
   * GoogCC congestion controller respect the configured max bitrate.
   * setParameters() alone cannot be used before the first negotiation completes,
   * so this SDP approach is the reliable cross-browser solution.
   */
  private injectBitrateIntoSdp(sdp: string, maxBitrate: number): string {
    if (!maxBitrate || maxBitrate <= 0) return sdp;
    const kbps = Math.round(maxBitrate / 1000);
    const lines = sdp.split('\r\n');
    const result: string[] = [];
    let inVideo = false;
    let injected = false;
    for (const line of lines) {
      if (line.startsWith('m=')) {
        inVideo = line.startsWith('m=video');
        injected = false;
      }
      // Skip any existing b= lines in the video section — we replace them.
      if (inVideo && line.startsWith('b=')) continue;
      result.push(line);
      // Inject immediately after c= in the video section.
      if (inVideo && !injected && line.startsWith('c=')) {
        result.push(`b=AS:${kbps}`);
        result.push(`b=TIAS:${maxBitrate}`);
        injected = true;
      }
    }
    return result.join('\r\n');
  }

  /**
   * Ensures all a=extmap IDs are globally unique across all bundled m-sections.
   *
   * Chrome can generate offers where different m-sections assign the same numeric
   * ID to different extension URIs (e.g. abs-send-time at ID 2 in the video section
   * and csrc-audio-level at ID 2 in the audio section). When the two sections are
   * bundled on a single transport the receiving peer rejects the SDP with
   * "Failed to update RTP header extensions … RTP extension ID reassignment".
   *
   * This method rewrites every a=extmap line so that each unique URI gets a single
   * canonical, globally-unique ID (first-occurrence wins; ID kept when possible).
   */
  private deduplicateExtmapIds(sdp: string): string {
    const uriToId = new Map<string, number>();
    const usedIds = new Set<number>();

    // First pass: assign a canonical ID to each URI.
    for (const line of sdp.split('\r\n')) {
      const m = line.match(/^a=extmap:(\d+)(?:\/\S+)?\s+(\S+)/);
      if (!m) continue;
      const origId = parseInt(m[1], 10);
      const uri = m[2];
      if (!uriToId.has(uri)) {
        if (!usedIds.has(origId)) {
          uriToId.set(uri, origId);
          usedIds.add(origId);
        } else {
          // Original ID already taken by a different URI — find the next free slot.
          let freeId = 1;
          while (usedIds.has(freeId)) freeId++;
          uriToId.set(uri, freeId);
          usedIds.add(freeId);
        }
      }
    }

    // Second pass: rewrite every a=extmap line with the canonical ID.
    return sdp.split('\r\n').map(line => {
      const m = line.match(/^a=extmap:(\d+)((?:\/\S+)?)\s+(\S+)(.*)/);
      if (!m) return line;
      const direction = m[2];
      const uri = m[3];
      const rest = m[4];
      const newId = uriToId.get(uri);
      return newId !== undefined ? `a=extmap:${newId}${direction} ${uri}${rest}` : line;
    }).join('\r\n');
  }

  private async handleViewerAnswer(answer: WebRtcClientOffer): Promise<void> {
    const pc = this.viewerConnections.get(answer.viewerId);
    if (!pc) return;
    try {
      await pc.setRemoteDescription(
        new RTCSessionDescription({type: answer.type as RTCSdpType, sdp: answer.sdp})
      );
      const buffered = this.viewerCandidateBuffer.get(answer.viewerId);
      if (buffered) {
        for (const c of buffered) {
          await pc.addIceCandidate(c).catch(e => console.error('Error adding buffered viewer candidate:', e));
        }
        this.viewerCandidateBuffer.delete(answer.viewerId);
      }
    } catch (err) {
      console.error('Error handling viewer answer:', err);
    }
  }

  private handleIceCandidateFromViewer(viewerId: string, candidate: RTCIceCandidateInit): void {
    const pc = this.viewerConnections.get(viewerId);
    if (!pc) return;
    const iceCandidate = new RTCIceCandidate(candidate);
    if (pc.remoteDescription) {
      pc.addIceCandidate(iceCandidate)
        .catch(e => console.error('Error adding ICE candidate from viewer:', e));
    } else {
      if (!this.viewerCandidateBuffer.has(viewerId)) this.viewerCandidateBuffer.set(viewerId, []);
      this.viewerCandidateBuffer.get(viewerId).push(iceCandidate);
    }
  }

  // ================================================================
  // Viewer API (P2P)
  // ================================================================

  /**
   * Opt-in watch: connect to a specific member's P2P stream.
   * The video will appear in the `popoutStream` / popout component.
   */
  public async startWatching(roomId: string, streamerId: string, username: string): Promise<void> {
    // Tear down any previous viewer connection first.
    this.cleanUpViewerSide();
    this.currentRoomId = roomId;
    this.currentViewingStreamerId = streamerId;
    this.incomingOfferInProgress = false;
    this.watchRequest.next({streamerId, username, roomId});
    if (token) {
      const isSfuOptInStream = await hubConnection.invoke<boolean>('IsSfuOptInStreamActive', token, roomId, streamerId)
        .catch(() => false);
      if (isSfuOptInStream) {
        await this.startWatchingSfu(roomId, streamerId);
        return;
      }

      await hubConnection.invoke('JoinWebRtcStream', token, roomId, streamerId)
        .catch(err => console.error('JoinWebRtcStream failed:', err));
    }
  }

  /** Stop watching the current P2P stream and dismiss the popout. */
  public stopWatching(): void {
    this.cleanUpViewerSide();
    this.watchRequest.next(null);
  }

  /** @deprecated Use startWatching() for the new Discord-style opt-in flow. */
  public async joinStream(roomId: string): Promise<void> {
    this.currentRoomId = roomId;
    if (token) {
      await hubConnection.invoke('JoinWebRtcStream', token, roomId, '')
        .catch(err => console.error('JoinWebRtcStream failed:', err));
    }
  }

  /** Leave the current P2P stream and clean up. */
  public leaveStream(): void {
    this.cleanUpViewerSide();
  }

  /** Request ICE restart from the specific streamer we are watching. */
  public async requestIceRestart(roomId: string): Promise<void> {
    if (token && this.currentViewingStreamerId) {
      await hubConnection.invoke('RequestIceRestart', token, roomId, this.currentViewingStreamerId)
        .catch(err => console.error('RequestIceRestart failed:', err));
    }
  }

  private cleanUpViewerSide(): void {
    this.streamerPc?.close();
    this.streamerPc = null;
    this.streamerCandidateBuffer = [];
    this.watchSfuConsumers.forEach(consumer => consumer.close());
    this.watchSfuConsumers.clear();
    this.watchSfuRecvTransport?.close();
    this.watchSfuRecvTransport = null;
    if (token && this.watchSfuRoomId) {
      hubConnection.invoke('LeaveSfuRoom', token, this.watchSfuRoomId).catch(() => {});
    }
    this.watchSfuRoomId = null;
    this.currentRoomId = null;
    this.currentViewingStreamerId = null;
    this.incomingOfferInProgress = false;
    this.popoutStream.next(null);
    this.pipActive.next(false);
    this.maybeStopRtcDebugStatsPolling();
  }

  private async startWatchingSfu(roomId: string, streamerId: string): Promise<void> {
    if (!token) return;

    await this.ensureSfuDevice();
    const liveRoomId = this.buildOptInLiveSfuRoomId(roomId, streamerId);
    this.watchSfuRoomId = liveRoomId;

    const existingProducers: SfuProducerEntry[] = await hubConnection.invoke<SfuProducerEntry[]>(
      'JoinSfuRoom', token, liveRoomId
    );

    const transportInfo: SfuTransportInfo = await hubConnection.invoke<SfuTransportInfo>(
      'CreateWebRtcTransport', token, liveRoomId, 1 /* Recv = 1 */
    );
    this.watchSfuRecvTransport = this.sfuDevice!.createRecvTransport({
      id: transportInfo.id,
      iceParameters: transportInfo.iceParameters as any,
      iceCandidates: transportInfo.iceCandidates as any,
      dtlsParameters: transportInfo.dtlsParameters as any
    });

    this.watchSfuRecvTransport.on('connect', async ({dtlsParameters}, callback, errback) => {
      try {
        await hubConnection.invoke('ConnectTransport', token, liveRoomId, transportInfo.id, dtlsParameters);
        callback();
      } catch (err) {
        errback(err);
      }
    });

    const recvTransport = this.watchSfuRecvTransport;
    for (const entry of existingProducers) {
      await this.consumeProducerToPopout(liveRoomId, recvTransport, entry.id);
    }
  }

  private async handleIncomingOffer(offer: WebRtcClientOffer): Promise<void> {
    this.streamerPc?.close();
    const config = await this.getWebRtcConfig();
    const pc = new RTCPeerConnection(config);
    this.streamerPc = pc;

    pc.onicecandidate = event => {
      if (event.candidate && token && this.currentRoomId && this.currentViewingStreamerId) {
        hubConnection.invoke(
          'SendIceCandidate', token, this.currentRoomId, this.currentViewingStreamerId, event.candidate
        ).catch(err => console.error('Error sending ICE candidate to streamer:', err));
      }
    };

    pc.ontrack = event => {
      if (event.streams?.[0]) {
        // P2P incoming stream goes to the popout, not the main media player.
        this.popoutStream.next(event.streams[0]);
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' && this.currentRoomId) {
        console.warn('Streamer connection failed, requesting ICE restart');
        this.requestIceRestart(this.currentRoomId);
      } else if (pc.connectionState === 'closed') {
        this.cleanUpViewerSide();
      }
    };

    // Read offer roomId so late-arriving viewers (auto-joined by broadcastStream) know their room.
    if (offer.roomId && !this.currentRoomId) this.currentRoomId = offer.roomId;

    try {
      await pc.setRemoteDescription(
        new RTCSessionDescription({type: offer.type as RTCSdpType, sdp: offer.sdp})
      );
      for (const c of this.streamerCandidateBuffer) {
        await pc.addIceCandidate(c).catch(e => console.error('Error adding buffered streamer candidate:', e));
      }
      this.streamerCandidateBuffer = [];
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      if (token && this.currentViewingStreamerId) {
        await hubConnection.invoke('CreateStreamAnswer', token, this.currentViewingStreamerId, {
          type: pc.localDescription.type,
          sdp: pc.localDescription.sdp,
          roomId: this.currentRoomId
        });
      }
    } catch (err) {
      console.error('Error handling streamer offer:', err);
    }
  }

  private handleIceCandidateFromStreamer(candidate: RTCIceCandidateInit): void {
    const iceCandidate = new RTCIceCandidate(candidate);
    if (this.streamerPc?.remoteDescription) {
      this.streamerPc.addIceCandidate(iceCandidate)
        .catch(e => console.error('Error adding ICE candidate from streamer:', e));
    } else {
      this.streamerCandidateBuffer.push(iceCandidate);
    }
  }

  // ================================================================
  // SignalR listeners
  // ================================================================

  private addListeners(): void {
    // Viewer side: a member started a P2P stream (Discord-style — no auto-join).
    // The user list will show a live indicator; the user must click Watch to opt in.
    hubConnection.on('startWebRtcStream', (_streamerId: string, _roomId: string) => {
      // Intentionally not calling streamStart.next() here — P2P does not switch the main player.
      // The userlist component reacts to the userupdate event (member.isstreaming) instead.
    });

    // Viewer side: a P2P stream ended.
    hubConnection.on('stopWebRtcStream', (streamerId: string) => {
      // Do NOT emit streamStop — P2P no longer drives the main media player.
      // Only clean up the popout viewer if this was the streamer we were watching.
      if (streamerId === this.currentViewingStreamerId) {
        this.cleanUpViewerSide();
        this.watchRequest.next(null);
      }
    });

    // Moderator broadcast: forced auto-join — everyone connects immediately.
    hubConnection.on('broadcastStream', (streamerId: string, roomId: string) => {
      // For force-broadcast, treat it like an explicit watch request.
      if (roomId && token) {
        this.startWatching(roomId, streamerId, '').catch(err =>
          console.error('JoinWebRtcStream (broadcast) failed:', err)
        );
      }
    });

    // Streamer side (P2P): a viewer wants to connect â€” create an offer for them
    hubConnection.on('joinWebRtcStream', (viewerId: string) => {
      this.handleViewerJoined(viewerId);
    });

    // Viewer side (P2P): streamer sent an offer
    hubConnection.on('sendOfferToViewer', (offer: WebRtcClientOffer) => {
      this.handleIncomingOffer(offer);
    });

    // Streamer side (P2P): viewer responded with an answer
    hubConnection.on('sendClientAnswer', (answer: WebRtcClientOffer) => {
      this.handleViewerAnswer(answer);
    });

    // Streamer side (P2P): ICE candidate from a viewer
    hubConnection.on('sendIceCandidateFromViewer', (viewerId: string, candidate: RTCIceCandidateInit) => {
      this.handleIceCandidateFromViewer(viewerId, candidate);
    });

    // Viewer side (P2P): ICE candidate from streamer
    hubConnection.on('sendIceCandidate', (candidate: RTCIceCandidateInit) => {
      this.handleIceCandidateFromStreamer(candidate);
    });

    // SFU: a new producer became available in the room
    hubConnection.on('sfuNewProducer', async (notification: SfuNewProducerNotification) => {
      if (this.watchSfuRecvTransport && this.watchSfuRoomId === notification.roomId) {
        const transport = this.watchSfuRecvTransport;
        await this.consumeProducerToPopout(
          this.watchSfuRoomId,
          transport,
          notification.producerId
        );
        return;
      }

      if (this.sfuRecvTransport && this.sfuRoomId === notification.roomId) {
        // Snapshot the transport reference before the first await so a concurrent
        // leaveStreamSfu / joinStreamSfu cannot replace it under our feet.
        const transport = this.sfuRecvTransport;
        await this.consumeProducer(
          this.sfuRoomId,
          transport,
          notification.producerId
        );
      }
    });

    // SFU: a producer was closed (streamer muted or disconnected).
    // Close and remove the matching consumer so the track is pulled from the stream.
    hubConnection.on('sfuProducerClosed', (producerId: string) => {
      for (const [consumerId, consumer] of this.watchSfuConsumers) {
        if (consumer.producerId === producerId) {
          consumer.track.stop();
          const stream = this.popoutStream.value;
          if (stream) {
            stream.removeTrack(consumer.track);
            this.popoutStream.next(stream.getTracks().length > 0 ? stream : null);
          }
          this.watchSfuConsumers.delete(consumerId);
          consumer.close();
          return;
        }
      }

      for (const [consumerId, consumer] of this.sfuConsumers) {
        if (consumer.producerId === producerId) {
          consumer.track.stop();
          const stream = this.remoteStream.value;
          if (stream) {
            stream.removeTrack(consumer.track);
            this.remoteStream.next(stream.getTracks().length > 0 ? stream : null);
          }
          this.sfuConsumers.delete(consumerId);
          consumer.close();
          break;
        }
      }
    });

    // SFU: viewers receive this when the streamer starts an SFU stream for the room.
    // NOTE: file shares do NOT call StartSfuStream (they use StartFileShare instead),
    // so this handler is only reached for regular SFU streams, not file shares.
    hubConnection.on('startSfuStream', async (roomId: string, _streamerId: string) => {
      // Skip if we are the file-share host — we already have a send-transport and
      // should NOT join as a viewer in response to our own StartSfuStream signal.
      if (this.isFileShareHost) return;
      this.streamStart.next(_streamerId);
      // Clean up any stale P2P viewer connection before joining SFU.
      this.cleanUpViewerSide();
      try {
        await this.joinStreamSfu(roomId);
      } catch (err) {
        console.error('Failed to join SFU room after startSfuStream:', err);
      }
    });

    // SFU: recording started notification.
    hubConnection.on('sfuRecordingStarted', (info: SfuRecordingInfo) => {
      this.sfuRecording.next(info);
    });

    // SFU: recording stopped notification.
    hubConnection.on('sfuRecordingStopped', (_roomId: string) => {
      this.sfuRecording.next(null);
    });

    // File Share: a room member started sharing a local file via SFU.
    // Viewers join the SFU room so they can consume the stream.
    hubConnection.on('fileShareStarted', async (streamerId: string, username: string, roomId: string) => {
      this.isPreparingFileShareHost = false;
      this.pendingFileShareFile.next(null);
      this.fileShareActive.next({streamerId, username});
      this.fileShareIsPaused.next(false);
      // Only viewers need to join the SFU — the host already has a send-transport.
      if (!this.isFileShareHost && roomId) {
        try {
          this.cleanUpViewerSide();
          await this.leaveStreamSfu();
          await this.joinStreamSfu(roomId);
        } catch (err) {
          console.error('fileShareStarted: joinStreamSfu failed:', err);
        }
      }
    });

    // File Share: the active share ended — tear down viewer SFU state.
    hubConnection.on('fileShareStopped', async () => {
      const wasHost = this.isFileShareHost;
      const skipTransportCleanup = this.fileShareStopInProgress;
      this.fileShareStopInProgress = false;
      this.isFileShareHost = false;
      this.isPreparingFileShareHost = false;
      this.pendingFileShareFile.next(null);
      this.fileShareActive.next(null);
      this.fileShareIsPaused.next(false);
      if (skipTransportCleanup) {
        return;
      }
      if (wasHost) {
        await this.teardownFileShareSender();
      } else {
        await this.leaveStreamSfu();
      }
    });

    // File Share: host paused/resumed — update the pause indicator for viewers.
    hubConnection.on('fileSharePlayPause', (isPlaying: boolean) => {
      this.fileShareIsPaused.next(!isPlaying);
    });
  }

  private removeListeners(): void {
    hubConnection.off('startWebRtcStream');
    hubConnection.off('stopWebRtcStream');
    hubConnection.off('broadcastStream');
    hubConnection.off('joinWebRtcStream');
    hubConnection.off('sendOfferToViewer');
    hubConnection.off('sendClientAnswer');
    hubConnection.off('sendIceCandidateFromViewer');
    hubConnection.off('sendIceCandidate');
    hubConnection.off('sfuNewProducer');
    hubConnection.off('sfuProducerClosed');
    hubConnection.off('startSfuStream');
    hubConnection.off('sfuRecordingStarted');
    hubConnection.off('sfuRecordingStopped');
    hubConnection.off('fileShareStarted');
    hubConnection.off('fileShareStopped');
    hubConnection.off('fileSharePlayPause');
  }

  // ================================================================
  // File Share — host streams a local file via SFU; viewers consume it
  // ================================================================

  /**
   * Set up the SFU send-transport and start producing tracks WITHOUT calling
   * StartSfuStream on the server.  StartSfuStream would broadcast
   * playertype(WebRtc) and startSfuStream to all room members, which would:
   *   (a) destroy the FileSharePlayerComponent on the host (playertype flip), and
   *   (b) cause viewers to call joinStreamSfu twice once fileShareStarted arrives.
   * Room coordination is handled exclusively by StartFileShare / StopFileShare.
   */
  private async startSfuSendTransportOnly(
    roomId: string,
    stream: MediaStream,
    maxBitrate?: number,
    preferredResolution?: number,
    profile: 'default' | 'file-share' = 'default'
  ): Promise<void> {
    if (!token) return;
    await this.ensureSfuDevice();
    this.sfuRoomId = roomId;
    this.localStream = stream;

    await hubConnection.invoke<SfuProducerEntry[]>('JoinSfuRoom', token, roomId);

    const transportInfo: SfuTransportInfo = await hubConnection.invoke<SfuTransportInfo>(
      'CreateWebRtcTransport', token, roomId, 0 /* Send = 0 */
    );
    this.sfuSendTransport = this.sfuDevice!.createSendTransport({
      id: transportInfo.id,
      iceParameters: transportInfo.iceParameters as any,
      iceCandidates: transportInfo.iceCandidates as any,
      dtlsParameters: transportInfo.dtlsParameters as any
    });

    this.sfuSendTransport.on('connect', async ({dtlsParameters}, callback, errback) => {
      try {
        await hubConnection.invoke('ConnectTransport', token, roomId, transportInfo.id, dtlsParameters);
        callback();
      } catch (err) { errback(err); }
    });

    this.sfuSendTransport.on('produce', async ({kind, rtpParameters}, callback, errback) => {
      try {
        const producerId = await hubConnection.invoke<string>(
          'Produce', token, roomId, transportInfo.id, kind, rtpParameters
        );
        callback({id: producerId});
      } catch (err) { errback(err); }
    });

    for (const track of stream.getTracks()) {
      const produceOptions: mediasoupClient.types.ProducerOptions = track.kind === 'video'
        ? this.buildVideoProducerOptions(track, maxBitrate, preferredResolution, profile)
        : {track};
      const producer = await this.sfuSendTransport.produce(produceOptions);
      this.sfuProducers.set(producer.id, producer);
    }
    this.ensureRtcDebugStatsPolling();
    // Intentionally NOT calling StartSfuStream — file share uses StartFileShare.
  }

  /**
   * Start sharing a local file with the room.
   * The caller must already have a MediaStream captured from the file's <video> element
   * via `videoElement.captureStream(fps)`.
   *
   * Sequence:
   * 1. Set up the SFU send-transport via startSfuSendTransportOnly (no StartSfuStream).
   * 2. Call StartFileShare on the server — sets the flag, sends playertype(FileShare)
   *    and fileShareStarted to all room members.
   *
   * The fileShareStarted listener handles the viewer-side SFU join.
   */
  public async startFileShare(roomId: string, stream: MediaStream, maxBitrate?: number): Promise<void> {
    if (!token) return;
    const bitrate = maxBitrate ?? 8_000_000;
    this.isFileShareHost = true;
    try {
      await this.startSfuSendTransportOnly(roomId, stream, bitrate, undefined, 'file-share');
      await hubConnection.invoke('StartFileShare', token, roomId);
      this.isPreparingFileShareHost = false;
      this.pendingFileShareFile.next(null);
    } catch (err) {
      this.isFileShareHost = false;
      this.isPreparingFileShareHost = false;
      this.pendingFileShareFile.next(null);
      for (const [id, producer] of this.sfuProducers) {
        try { await hubConnection.invoke('CloseProducer', token, roomId, id); } catch { /* best-effort */ }
        producer.close();
      }
      this.sfuProducers.clear();
      this.sfuSendTransport?.close();
      this.sfuSendTransport = null;
      await hubConnection.invoke('LeaveSfuRoom', token, roomId).catch(() => {});
      this.sfuRoomId = null;
      throw err;
    }
  }

  /**
   * Stop the active file share.
   * StopFileShare on the server already handles flag cleanup, notifying all members
   * (fileShareStopped) and restoring the previous playertype. We then tear down the
   * local SFU send-transport without calling StopSfuStream (which would redundantly
   * broadcast again and confuse room state).
   */
  public async stopFileShare(roomId: string): Promise<void> {
    if (!token) return;
    this.isFileShareHost = false;
    this.isPreparingFileShareHost = false;
    this.pendingFileShareFile.next(null);
    this.fileShareStopInProgress = true;
    // Server-side cleanup + notifications.
    await hubConnection.invoke('StopFileShare', token, roomId)
      .catch(err => console.error('StopFileShare failed:', err));
    await this.teardownFileShareSender(roomId);
    this.fileShareStopInProgress = false;
    this.fileShareActive.next(null);
    this.fileShareIsPaused.next(false);
  }

  private async teardownFileShareSender(roomId?: string): Promise<void> {
    const activeRoomId = roomId ?? this.sfuRoomId;
    for (const [id, producer] of this.sfuProducers) {
      if (token && activeRoomId) {
        try { await hubConnection.invoke('CloseProducer', token, activeRoomId, id); } catch { /* best-effort */ }
      }
      producer.close();
    }
    this.sfuProducers.clear();
    this.sfuSendTransport?.close();
    this.sfuSendTransport = null;
    if (token && activeRoomId) {
      await hubConnection.invoke('LeaveSfuRoom', token, activeRoomId).catch(() => {});
    }
    this.sfuRoomId = null;
    this.maybeStopRtcDebugStatsPolling();
  }

  /**
   * Broadcast the current play/pause state to all room members.
   * Call this whenever the local <video> element plays or pauses.
   */
  public async broadcastFileSharePlayPause(roomId: string, isPlaying: boolean): Promise<void> {
    if (!token) return;
    await hubConnection.invoke('FileSharePlayPause', token, roomId, isPlaying)
      .catch(err => console.error('FileSharePlayPause failed:', err));
  }

  // ================================================================
  // Broadcast (Moderator-only P2P)
  // ================================================================

  /**
   * Starts a forced P2P broadcast to the room — all existing room members will
   * automatically receive and display the stream. Requires Moderator privilege
   * (enforced server-side via `ForceBroadcast` hub method).
   */
  public async broadcastToRoom(roomId: string, stream: MediaStream, maxBitrate?: number): Promise<void> {
    this.currentRoomId = roomId;
    this.localStream = stream;
    this.localStreamMaxBitrate = maxBitrate ?? 0;
    this.invalidateCredentials();
    if (token) {
      await hubConnection.invoke('ForceBroadcast', token, roomId)
        .catch(err => console.error('ForceBroadcast failed:', err));
    }
  }

  /** Stop a moderator broadcast (calls the same StopWebRtcStream under the hood). */
  public async stopBroadcast(roomId: string): Promise<void> {
    await this.stopStreaming(roomId);
  }

  // ================================================================
  // SFU — Adaptive Bitrate: preferred layers
  // ================================================================

  /**
   * Sets the preferred simulcast layer for a consumer.
   * Call with spatialLayer 0 (lowest) to 2 (highest) to adapt to bandwidth.
   */
  public async setPreferredLayers(roomId: string, consumerId: string, spatialLayer: number, temporalLayer: number = 2): Promise<void> {
    if (!token) return;
    await hubConnection.invoke('SetPreferredLayers', token, roomId, consumerId, spatialLayer, temporalLayer)
      .catch(err => console.error('SetPreferredLayers failed:', err));
  }

  /** Returns all consumer IDs currently active (for use with setPreferredLayers). */
  public getSfuConsumerIds(): string[] {
    return [...this.sfuConsumers.keys()];
  }

  // ================================================================
  // SFU — Recording
  // ================================================================

  /** Starts server-side recording for the SFU room. */
  public async startRecording(roomId: string): Promise<void> {
    if (!token) return;
    await hubConnection.invoke('StartRecording', token, roomId)
      .catch(err => console.error('StartRecording failed:', err));
  }

  /** Stops the active server-side recording. */
  public async stopRecording(roomId: string): Promise<void> {
    if (!token) return;
    await hubConnection.invoke('StopRecording', token, roomId)
      .catch(err => console.error('StopRecording failed:', err));
  }

  private cleanUpAll(): void {
    this.cleanUpStreamerSide();
    this.cleanUpViewerSide();
    this.sfuConsumers.forEach(c => c.close());
    this.sfuConsumers.clear();
    this.sfuProducers.forEach(p => p.close());
    this.sfuProducers.clear();
    this.sfuSendTransport?.close();
    this.sfuSendTransport = null;
    this.sfuRecvTransport?.close();
    this.sfuRecvTransport = null;
    this.sfuDevice = null;
    this.sfuRoomId = null;
    this.streamStart.next(null);
    this.streamStop.next(null);
    this.popoutStream.next(null);
    this.watchRequest.next(null);
    this.pipActive.next(false);
    this.sfuRecording.next(null);
    this.isFileShareHost = false;
    this.isPreparingFileShareHost = false;
    this.pendingFileShareFile.next(null);
    this.fileShareActive.next(null);
    this.fileShareIsPaused.next(false);
    this.maybeStopRtcDebugStatsPolling();
  }
}

// ================================================================
// Interfaces
// ================================================================

export interface WebRtcCredentials {
  username: string;
  password: string;
  stunServer: string;
  turnServer: string;
}

export interface WebRtcClientOffer {
  type: string;
  sdp: string;
  viewerId?: string;
  roomId?: string;
}

export enum Resolution {
  HD = 720,
  FHD = 1080,
  QHD = 1440,
  UHD = 2160
}

export interface WebRtcCandidateExchange extends RTCIceCandidate {
  viewerId: string;
}

/** Matches SfuTransportInfo on the backend. */
interface SfuTransportInfo {
  id: string;
  iceParameters: object;
  iceCandidates: object[];
  dtlsParameters: object;
}

/** Matches SfuConsumerInfo on the backend. */
interface SfuConsumerInfo {
  id: string;
  producerId: string;
  kind: string;
  rtpParameters: object;
}

/** Matches SfuProducerEntry on the backend. */
interface SfuProducerEntry {
  id: string;
  kind: string;
  peerId: string;
}

/** Matches SfuNewProducerNotification on the backend. */
interface SfuNewProducerNotification {
  producerId: string;
  peerId: string;
  kind: string;
  roomId: string;
}

/** Matches SfuRecordingInfo on the backend. */
export interface SfuRecordingInfo {
  roomId: string;
  filename: string;
  startedAtUnixMs: number;
}


