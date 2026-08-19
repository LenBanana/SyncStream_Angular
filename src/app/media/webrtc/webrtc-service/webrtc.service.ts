import {Injectable, OnDestroy} from '@angular/core';
import {BehaviorSubject, Subject} from 'rxjs';
import {SignalRService, hubConnection, baseUrl} from '../../../services/signal-r.service';
import {token} from '../../../global.settings';
import {HttpClient} from "@angular/common/http";
import * as mediasoupClient from 'mediasoup-client';

export type RtmpSubtitleMode = 'auto' | 'always' | 'never';
export type RtmpAudioLanguagePreference = 'japanese' | 'english' | 'german' | 'other';
export type RtmpSubtitleBurnMethod = 'text' | 'bitmap';

export interface RtmpPlaybackPreferences {
  subtitleMode: RtmpSubtitleMode;
  audioLanguagePriority: RtmpAudioLanguagePreference[];
  selectedAudioOrdinal?: number | null;
  selectedSubtitleOrdinal?: number | null;
  selectedSubtitleCodecName?: string | null;
}

export interface RtmpLocalMediaTrack {
  ordinal: number;
  label: string;
  language: string;
  title: string;
  codecName: string;
  isDefault: boolean;
  isForced: boolean;
  burnMethod?: RtmpSubtitleBurnMethod | null;
  burnable?: boolean;
}

export interface RtmpLocalMediaProbeResult {
  audioTracks: RtmpLocalMediaTrack[];
  subtitleTracks: RtmpLocalMediaTrack[];
}

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
  /** Max framerate requested by the streamer; 0 = unconstrained. */
  private localStreamMaxFrameRate = 0;
  /** Encoder priority requested by the streamer. */
  private localStreamContentPreference: StreamContentPreference = 'motion';
  /** True when the current live screen-share session is using the SFU path rather than P2P. */
  private liveStreamUsesSfu = false;
  /** Whether the current local stream is opt-in live or room-stage live. */
  private localStreamAudience: 'none' | 'personal' | 'room' = 'none';

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
  private sfuDeviceLoading: Promise<void> | null = null;
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
  /** True when the active share is server-side (ffmpeg→mediasoup); host is also a consumer. */
  public isServerFileShare: boolean = false;
  /** True while this client has opened the host file-share UI but has not finished starting the share yet. */
  public isPreparingFileShareHost: boolean = false;
  /** File selected in the side-nav and waiting for the host player to start streaming it. */
  public pendingFileShareFile: BehaviorSubject<File | null> = new BehaviorSubject<File | null>(null);
  /** Upload progress (0-100) while uploading a file for server-side streaming; 0 when idle. */
  public fileShareUploadProgress = new BehaviorSubject<number>(0);
  /** True while the background chunk upload is still running after the stream has gone live. */
  public backgroundUploadInProgress = new BehaviorSubject<boolean>(false);
  /** Emits an error message if the background upload fails unrecoverably. */
  public serverShareUploadError = new Subject<string>();
  /** True while the local host is stopping a file share through the explicit stop path. */
  private fileShareStopInProgress = false;
  /** uploadId of the in-progress server-share upload; null when idle. */
  private _serverShareUploadId: string | null = null;
  /** Duration (seconds) of the file currently being shared via the server path; null when unknown. */
  private _serverShareFileDuration: number | null = null;
  /**
   * Fires when the local user (who is the room host / an Approved member) clicks
   * "Share File" in the side-nav. Media component listens and switches the player
   * to FileShare mode so the self-contained FileSharePlayerComponent can render.
   */
  public fileShareHostRequested: Subject<void> = new Subject<void>();

  // ---------- RTMP file-share state ----------
  /** Emits info about who is streaming via RTMP file-share; null when inactive. */
  public rtmpFileShareActive: BehaviorSubject<{streamerId: string; username: string; streamUrl: string; durationSec?: number | null} | null> =
    new BehaviorSubject<{streamerId: string; username: string; streamUrl: string; durationSec?: number | null} | null>(null);
  /** True when playback is paused on the host side. */
  public rtmpFileShareIsPaused: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  /** Host's current position in seconds; updated by periodic server broadcast. */
  public rtmpFileSharePosition: BehaviorSubject<number> = new BehaviorSubject<number>(0);
  /** True once the RTMP share may be seeked cleanly. */
  public rtmpFileShareCanSeek: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  /** Fires when the host seeks — viewers should reconnect their mpegts player. */
  public rtmpFileShareSeekSignal: Subject<number> = new Subject<number>();
  /** Fires when the RTMP publisher is live again after a restart and clients may reconnect. */
  public rtmpFileShareStreamReady: Subject<number> = new Subject<number>();
  /** Emits the VOD playback URL once a completed RTMP upload has been finalized for normal playback. */
  public rtmpFileShareVodPlayback: BehaviorSubject<{playbackUrl: string; durationSec?: number | null; contentType?: string | null} | null> =
    new BehaviorSubject<{playbackUrl: string; durationSec?: number | null; contentType?: string | null} | null>(null);
  /** True when this client is the host of an RTMP file-share. */
  public isRtmpFileShareHost: boolean = false;
  /** True while this client has opened the RTMP host UI but has not finished starting. */
  public isPreparingRtmpFileShareHost: boolean = false;
  /** File selected for RTMP share, waiting for the component to start the upload. */
  public pendingRtmpFileShareFile: BehaviorSubject<File | null> = new BehaviorSubject<File | null>(null);
  /** Upload progress (0-100) for the RTMP background upload. */
  public rtmpFileShareUploadProgress = new BehaviorSubject<number>(0);
  /** True while the background chunk upload is still running after the RTMP stream is live. */
  public rtmpFileShareBackgroundUploadInProgress = new BehaviorSubject<boolean>(false);
  /** Emits an error message if the RTMP background upload fails. */
  public rtmpFileShareUploadError = new Subject<string>();
  /** Fires when "Share File (RTMP)" is clicked — media component switches to RtmpFileShare player. */
  public rtmpFileShareHostRequested: Subject<void> = new Subject<void>();
  private _rtmpShareUploadId: string | null = null;
  private _rtmpShareFileDuration: number | null = null;
  private _rtmpShareStopInProgress = false;

  /** Whether the SFU is available (checked once per session). */
  public sfuAvailable: boolean = false;
  /** Emits recording info when a recording starts, null when it stops. */
  public sfuRecording: BehaviorSubject<SfuRecordingInfo | null> = new BehaviorSubject<SfuRecordingInfo | null>(null);
  /** True while this client is actively streaming directly to the room player. */
  public roomStageBroadcastActive: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  /** Local preview stream for the broadcaster in room-stage mode. */
  public roomStagePreviewStream: BehaviorSubject<MediaStream | null> = new BehaviorSubject<MediaStream | null>(null);

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

  private logPopoutDebug(message: string, details?: unknown): void {
    if (details === undefined) {
      console.debug(`[WebRTC popout] ${message}`);
      return;
    }

    console.debug(`[WebRTC popout] ${message}`, details);
  }

  private describeTrack(track: MediaStreamTrack): Record<string, unknown> {
    return {
      id: track.id,
      kind: track.kind,
      label: track.label,
      enabled: track.enabled,
      muted: track.muted,
      readyState: track.readyState,
      settings: typeof track.getSettings === 'function' ? track.getSettings() : null
    };
  }

  private describeStream(stream: MediaStream | null): Record<string, unknown> {
    if (!stream) {
      return {present: false};
    }

    return {
      present: true,
      id: stream.id,
      active: stream.active,
      tracks: stream.getTracks().map(track => this.describeTrack(track))
    };
  }

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
    this.credentialExpiry = fresh.expiresAtUnixSec;
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

  private applyVideoTrackContentPreference(
    track: MediaStreamTrack,
    contentPreference: StreamContentPreference
  ): boolean {
    const isDisplay = this.isDisplayTrack(track);
    try {
      // contentHint guides the encoder: 'detail' keeps screen text sharp, while
      // 'motion' asks the browser to preserve framerate for games/video.
      track.contentHint = isDisplay ? contentPreference : 'motion';
    } catch {
      // Best-effort only.
    }
    return isDisplay;
  }

  private applyStreamContentPreference(stream: MediaStream, contentPreference: StreamContentPreference): void {
    stream.getVideoTracks().forEach(track => this.applyVideoTrackContentPreference(track, contentPreference));
  }

  private findVideoCodec(
    mimeType: string,
    predicate?: (codec: any) => boolean
  ): mediasoupClient.types.RtpCodecCapability | undefined {
    return this.sfuDevice?.rtpCapabilities.codecs?.find((codec: any) => {
      if (codec.mimeType?.toLowerCase() !== mimeType.toLowerCase()) return false;
      return predicate ? predicate(codec) : true;
    }) as mediasoupClient.types.RtpCodecCapability | undefined;
  }

  private findMotionCodec(): mediasoupClient.types.RtpCodecCapability | undefined {
    return this.findVideoCodec('video/h264', (codec: any) => {
      const profile = String(codec.parameters?.['profile-level-id'] ?? '').toLowerCase();
      return profile.startsWith('42e0');
    })
      ?? this.findVideoCodec('video/h264')
      ?? this.findVideoCodec('video/vp8');
  }

  private buildSingleVideoEncoding(
    track: MediaStreamTrack,
    topBitrate: number,
    preferredResolution?: number,
    preferredFrameRate?: number
  ): mediasoupClient.types.RtpEncodingParameters {
    const settings = track.getSettings();
    const sourceHeight = typeof settings.height === 'number' && settings.height > 0
      ? settings.height
      : (preferredResolution && preferredResolution > 0 ? preferredResolution : 1080);
    const targetHeight = preferredResolution && preferredResolution > 0
      ? Math.min(preferredResolution, sourceHeight)
      : sourceHeight;
    const scaleResolutionDownBy = Number(Math.max(1, sourceHeight / targetHeight).toFixed(2));
    const frameRate = preferredFrameRate && preferredFrameRate > 0 ? preferredFrameRate : undefined;

    return {
      maxBitrate: topBitrate,
      maxFramerate: frameRate,
      scaleResolutionDownBy
    } as any;
  }

  /**
   * Builds 3-layer VP8 simulcast encodings for a display (screen-share) track.
   * Uses the source and target resolution to calculate scale factors, giving
   * viewers on constrained links a usable mid-resolution fallback layer.
   */
  private buildDisplayEncodings(
    track: MediaStreamTrack,
    topBitrate: number,
    preferredResolution?: number,
    preferredFrameRate?: number,
    contentPreference: StreamContentPreference = 'motion'
  ): {
    encodings: mediasoupClient.types.ProducerOptions['encodings'];
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
    const highScale  = Math.max(1, sourceHeight / targetHeight);
    const midScale   = Math.max(highScale, highScale * 2);
    const lowScale   = Math.max(midScale,  highScale * 4);
    const temporalMode = contentPreference === 'motion' || (preferredFrameRate ?? 0) >= 60 ? 'L1T3' : 'L1T2';
    const frameRate = preferredFrameRate && preferredFrameRate > 0 ? preferredFrameRate : undefined;

    return {
      encodings: [
        {rid: 'q', maxBitrate: Math.max(400_000,  Math.round(topBitrate / 8)), scaleResolutionDownBy: Number(lowScale.toFixed(2)),  scalabilityMode: temporalMode, maxFramerate: frameRate},
        {rid: 'h', maxBitrate: Math.max(1_000_000, Math.round(topBitrate / 3)), scaleResolutionDownBy: Number(midScale.toFixed(2)),   scalabilityMode: temporalMode, maxFramerate: frameRate},
        {rid: 'f', maxBitrate: topBitrate,                                       scaleResolutionDownBy: Number(highScale.toFixed(2)),  scalabilityMode: temporalMode, maxFramerate: frameRate},
      ] as any,
      sourceHeight,
      targetHeight
    };
  }

  private buildVideoProducerOptions(
    track: MediaStreamTrack,
    maxBitrate?: number,
    preferredResolution?: number,
    preferredFrameRate?: number,
    contentPreference: StreamContentPreference = 'motion'
  ): mediasoupClient.types.ProducerOptions {
    const topBitrate = maxBitrate && maxBitrate > 0 ? maxBitrate : 6_000_000;
    const isDisplay = this.applyVideoTrackContentPreference(track, contentPreference);
    const frameRate = preferredFrameRate && preferredFrameRate > 0 ? preferredFrameRate : undefined;

    const produceOptions: mediasoupClient.types.ProducerOptions = {
      track,
      codecOptions: {videoGoogleStartBitrate: Math.max(1000, Math.round(topBitrate / 1000))}
    };

    if (contentPreference === 'motion') {
      const motionCodec = this.findMotionCodec();
      if (motionCodec) {
        produceOptions.codec = motionCodec as any;
      }
      produceOptions.encodings = [
        this.buildSingleVideoEncoding(track, topBitrate, preferredResolution, preferredFrameRate)
      ] as any;
      return produceOptions;
    }

    // Prefer VP9 K-SVC (L3T3_KEY): a single encoding covers 3 spatial × 3 temporal
    // layers.  Each viewer independently receives the layer that fits their link.
    // The whole stream is encoded once on the sender side.  Falls back to VP8
    // simulcast when the browser or SFU doesn't negotiate VP9.
    const vp9Codec = this.sfuDevice?.rtpCapabilities.codecs?.find(
      (c: any) => c.mimeType?.toLowerCase() === 'video/vp9'
    );
    if (vp9Codec) {
      produceOptions.codec = vp9Codec as any;
      produceOptions.encodings = [{scalabilityMode: 'L3T3_KEY', maxBitrate: topBitrate, maxFramerate: frameRate}] as any;
      return produceOptions;
    }

    // VP8 fallback: 3-layer simulcast with L1T2 temporal scalability on each layer.
    // Low (q) = 1/8 bitrate @ ¼ resolution, mid (h) = 1/3 bitrate @ ½ resolution,
    // full (f) = top bitrate @ native resolution.
    if (isDisplay) {
      if (preferredResolution && preferredResolution > 0) {
        const displayProfile = this.buildDisplayEncodings(track, topBitrate, preferredResolution, preferredFrameRate, contentPreference);
        produceOptions.encodings = displayProfile.encodings as any;
      } else {
        produceOptions.encodings = [{maxBitrate: topBitrate, maxFramerate: frameRate}];
      }
    } else {
      const temporalMode = frameRate && frameRate >= 60 ? 'L1T3' : 'L1T2';
      produceOptions.encodings = [
        {rid: 'q', maxBitrate: Math.round(topBitrate / 8), scaleResolutionDownBy: 4, scalabilityMode: temporalMode, maxFramerate: frameRate},
        {rid: 'h', maxBitrate: Math.round(topBitrate / 3), scaleResolutionDownBy: 2, scalabilityMode: temporalMode, maxFramerate: frameRate},
        {rid: 'f', maxBitrate: topBitrate,                                            scalabilityMode: temporalMode, maxFramerate: frameRate},
      ] as any;
    }

    return produceOptions;
  }

  /**
   * Builds mediasoup-client ProducerOptions for an audio track.
   * Enables Opus stereo, in-band Forward Error Correction (FEC), and raises the
   * max average bitrate to the Opus ceiling (510 kbps) so the encoder is not
   * artificially capped below what the connection can carry.  DTX is disabled
   * because it creates audible cut-in artifacts for mixed music/speech content.
   */
  private buildAudioProducerOptions(track: MediaStreamTrack): mediasoupClient.types.ProducerOptions {
    return {
      track,
      codecOptions: {
        opusStereo: true,
        opusFec: true,
        opusDtx: false,
        opusMaxAverageBitrate: 510_000
      }
    };
  }

  // ================================================================
  // SFU Streamer API
  // ================================================================

  /**
   * Starts streaming via the SFU.  Falls back to P2P if SFU is not available.
   */
  public async startStreamingSfu(
    roomId: string,
    stream: MediaStream,
    maxBitrate?: number,
    preferredResolution?: number,
    preferredFrameRate?: number,
    contentPreference: StreamContentPreference = 'motion'
  ): Promise<void> {
    if (!token) return;

    await this.ensureSfuDevice();
    this.liveStreamUsesSfu = true;
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
        ? this.buildVideoProducerOptions(track, maxBitrate, preferredResolution, preferredFrameRate, contentPreference)
        : this.buildAudioProducerOptions(track);
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
    this.cleanUpStreamerSide();
  }

  /**
   * Starts an opt-in live screen-share over the SFU without switching the room's
   * main player or auto-joining viewers.
   */
  private async startOptInStreamingSfu(
    roomId: string,
    stream: MediaStream,
    maxBitrate?: number,
    preferredResolution?: number,
    preferredFrameRate?: number,
    contentPreference: StreamContentPreference = 'motion'
  ): Promise<void> {
    if (!token) return;
    const bitrate = maxBitrate ?? this.localStreamMaxBitrate;

    this.liveStreamUsesSfu = true;
    try {
      const liveRoomId = await hubConnection.invoke<string>('StartSfuOptInStream', token, roomId);
      if (!liveRoomId) {
        throw new Error('StartSfuOptInStream did not return a live room id.');
      }

      await this.startSfuSendTransportOnly(liveRoomId, stream, bitrate, preferredResolution, preferredFrameRate, contentPreference);
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
  // SFU Viewer API
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
      // Only request preferred layers when multiple encodings are exposed.
      // Single-encoding consumers should start on their default/base layer.
      if (consumer.kind === 'video' && consumer.rtpParameters.encodings.length > 1) {
        const {spatial, temporal} = this.getMaxPreferredLayers(consumer);
        this.setPreferredLayers(roomId, consumer.id, spatial, temporal).catch(() => { /* best-effort */ });
      }
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
      this.logPopoutDebug('Consuming popout producer', {roomId, transportId: transport.id, producerId});
      const consumerInfo: SfuConsumerInfo = await hubConnection.invoke<SfuConsumerInfo>(
        'Consume', token, roomId, transport.id, producerId, this.sfuDevice.rtpCapabilities
      );
      const consumer = await transport.consume({
        id: consumerInfo.id,
        producerId: consumerInfo.producerId,
        kind: consumerInfo.kind as 'audio' | 'video',
        rtpParameters: consumerInfo.rtpParameters as any
      });
      this.logPopoutDebug('Popout consumer created', {
        roomId,
        producerId,
        consumerId: consumer.id,
        kind: consumer.kind,
        track: this.describeTrack(consumer.track),
        encodingCount: consumer.rtpParameters.encodings?.length ?? 0
      });
      this.watchSfuConsumers.set(consumer.id, consumer);
      if (consumer.kind === 'video' && consumer.rtpParameters.encodings.length > 1) {
        const {spatial, temporal} = this.getMaxPreferredLayers(consumer);
        this.setPreferredLayers(roomId, consumer.id, spatial, temporal).catch(() => { /* best-effort */ });
        this.logPopoutDebug('Requested preferred layers for popout consumer', {
          roomId,
          consumerId: consumer.id,
          spatial,
          temporal
        });
      }
      this.ensureRtcDebugStatsPolling();

      const stream = this.popoutStream.value ?? new MediaStream();
      stream.addTrack(consumer.track);
      this.logPopoutDebug('Added consumer track to popout stream', this.describeStream(stream));
      this.popoutStream.next(stream);

      consumer.track.addEventListener('mute', () => {
        this.logPopoutDebug('Popout consumer track muted', {consumerId: consumer.id, track: this.describeTrack(consumer.track)});
      });
      consumer.track.addEventListener('unmute', () => {
        this.logPopoutDebug('Popout consumer track unmuted', {consumerId: consumer.id, track: this.describeTrack(consumer.track)});
      });
      consumer.track.addEventListener('ended', () => {
        this.logPopoutDebug('Popout consumer track ended', {consumerId: consumer.id, track: this.describeTrack(consumer.track)});
      });

      const removeTrack = () => {
        consumer.track.stop();
        stream.removeTrack(consumer.track);
        this.watchSfuConsumers.delete(consumer.id);
        this.logPopoutDebug('Removed consumer track from popout stream', {
          consumerId: consumer.id,
          remainingStream: this.describeStream(stream)
        });
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
    if (this.sfuDeviceLoading) return this.sfuDeviceLoading;
    if (!token) return;
    this.sfuDeviceLoading = (async () => {
      const rtpCapabilities = await hubConnection.invoke<object>('GetRouterRtpCapabilities', token);
      this.sfuDevice = new mediasoupClient.Device();
      await this.sfuDevice.load({routerRtpCapabilities: rtpCapabilities as any});
    })();
    try {
      await this.sfuDeviceLoading;
    } finally {
      this.sfuDeviceLoading = null;
    }
  }

  // ================================================================
  // Streamer API (P2P â€“ kept for backward compat / SFU fallback)
  // ================================================================

  /** Begin broadcasting via P2P. Use startStreamingSfu when SFU is available. */
  public async startStreaming(
    roomId: string,
    stream: MediaStream,
    maxBitrate?: number,
    preferredResolution?: number,
    preferredFrameRate?: number,
    contentPreference: StreamContentPreference = 'motion'
  ): Promise<void> {
    this.currentRoomId = roomId;
    this.localStream = stream;
    this.applyStreamContentPreference(stream, contentPreference);
    this.localStreamMaxBitrate = maxBitrate ?? 0;
    this.localStreamMaxFrameRate = preferredFrameRate ?? 0;
    this.localStreamContentPreference = contentPreference;
    this.localStreamAudience = 'personal';
    const canUseSfu = await this.checkSfuAvailable();
    if (canUseSfu) {
      await this.startOptInStreamingSfu(roomId, stream, maxBitrate, preferredResolution, preferredFrameRate, contentPreference);
      return;
    }

    this.liveStreamUsesSfu = false;
    this.invalidateCredentials();
    if (token) {
      await hubConnection.invoke('StartWebRtcStream', token, roomId)
        .catch(err => console.error('StartWebRtcStream failed:', err));
    }
  }

  /** Begin streaming directly to the room player instead of the opt-in live list. */
  public async startStreamingToRoom(
    roomId: string,
    stream: MediaStream,
    maxBitrate?: number,
    preferredResolution?: number,
    preferredFrameRate?: number,
    contentPreference: StreamContentPreference = 'motion'
  ): Promise<void> {
    this.currentRoomId = roomId;
    this.localStream = stream;
    this.applyStreamContentPreference(stream, contentPreference);
    this.localStreamMaxBitrate = maxBitrate ?? 0;
    this.localStreamMaxFrameRate = preferredFrameRate ?? 0;
    this.localStreamContentPreference = contentPreference;
    this.localStreamAudience = 'room';
    this.roomStagePreviewStream.next(stream);
    this.roomStageBroadcastActive.next(true);

    try {
      const canUseSfu = await this.checkSfuAvailable();
      if (canUseSfu) {
        await this.startStreamingSfu(roomId, stream, maxBitrate, preferredResolution, preferredFrameRate, contentPreference);
        return;
      }

      this.liveStreamUsesSfu = false;
      this.invalidateCredentials();
      if (token) {
        await hubConnection.invoke('StartWebRtcStream', token, roomId)
          .catch(err => console.error('StartWebRtcStream failed:', err));
      }
    } catch (err) {
      this.localStreamAudience = 'none';
      this.roomStagePreviewStream.next(null);
      this.roomStageBroadcastActive.next(false);
      throw err;
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

  /** Stop a room-wide live stream and restore the normal room player state. */
  public async stopStreamingToRoom(roomId: string): Promise<void> {
    if (this.liveStreamUsesSfu) {
      await this.stopStreamingSfu(roomId);
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
    this.localStream?.getTracks().forEach(track => track.stop());
    this.localStream = null;
    this.localStreamMaxBitrate = 0;
    this.localStreamMaxFrameRate = 0;
    this.localStreamContentPreference = 'motion';
    this.liveStreamUsesSfu = false;
    this.localStreamAudience = 'none';
    this.roomStagePreviewStream.next(null);
    this.roomStageBroadcastActive.next(false);
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
      if (pc.connectionState === 'connected') {
        pc.getSenders()
          .filter(s => s.track?.kind === 'video')
          .forEach(sender => {
            const p = sender.getParameters();
            if (p.encodings?.length) {
              p.encodings.forEach(e => {
                if (this.localStreamMaxBitrate > 0) {
                  e.maxBitrate = this.localStreamMaxBitrate;
                }
                if (this.localStreamMaxFrameRate > 0) {
                  (e as any).maxFramerate = this.localStreamMaxFrameRate;
                }
              });
              (p as any).degradationPreference = this.localStreamContentPreference === 'motion'
                ? 'maintain-framerate'
                : 'maintain-resolution';
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
    this.logPopoutDebug('startWatching requested', {roomId, streamerId, username});
    if (token) {
      const isSfuOptInStream = await hubConnection.invoke<boolean>('IsSfuOptInStreamActive', token, roomId, streamerId)
        .catch(() => false);
      this.logPopoutDebug('IsSfuOptInStreamActive result', {roomId, streamerId, isSfuOptInStream});
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
    this.logPopoutDebug('cleanUpViewerSide', {
      currentRoomId: this.currentRoomId,
      currentViewingStreamerId: this.currentViewingStreamerId,
      watchSfuRoomId: this.watchSfuRoomId,
      watchSfuConsumers: this.watchSfuConsumers.size,
      stream: this.describeStream(this.popoutStream.value)
    });
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
    this.logPopoutDebug('Joining SFU watch room', {roomId, streamerId, liveRoomId});

    const existingProducers: SfuProducerEntry[] = await hubConnection.invoke<SfuProducerEntry[]>(
      'JoinSfuRoom', token, liveRoomId
    );
    this.logPopoutDebug('Joined SFU watch room', {
      liveRoomId,
      existingProducerCount: existingProducers.length,
      existingProducers
    });

    const transportInfo: SfuTransportInfo = await hubConnection.invoke<SfuTransportInfo>(
      'CreateWebRtcTransport', token, liveRoomId, 1 /* Recv = 1 */
    );
    this.logPopoutDebug('Created SFU watch recv transport', {
      liveRoomId,
      transportId: transportInfo.id,
      iceCandidateCount: transportInfo.iceCandidates?.length ?? 0
    });
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
        this.logPopoutDebug('broadcastStream received', {roomId, streamerId});
        this.startWatching(roomId, streamerId, '').catch(err =>
          console.error('JoinWebRtcStream (broadcast) failed:', err)
        );
      }
    });

    // Streamer side (P2P): a viewer wants to connect create an offer for them
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
      if (this.watchSfuRoomId === notification.roomId) {
        this.logPopoutDebug('sfuNewProducer for active popout watch room', notification);
      }
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
      // Only viewers need to join the SFU as consumers — UNLESS this is a server-side share,
      // in which case the host also becomes a consumer (there is no local send-transport).
      if ((!this.isFileShareHost || this.isServerFileShare) && roomId) {
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
      const wasHost        = this.isFileShareHost;
      const wasServerShare = this.isServerFileShare;
      const skipTransportCleanup = this.fileShareStopInProgress;
      this.fileShareStopInProgress = false;
      this.isFileShareHost    = false;
      this.isServerFileShare  = false;
      this.isPreparingFileShareHost = false;
      this.pendingFileShareFile.next(null);
      this.fileShareUploadProgress.next(0);
      this.backgroundUploadInProgress.next(false);
      this._serverShareFileDuration = null;
      this.fileShareActive.next(null);
      this.fileShareIsPaused.next(false);
      if (skipTransportCleanup) {
        // stopFileShare() already handled teardown synchronously.
        return;
      }
      if (wasHost && !wasServerShare) {
        // Normal host disconnect: close the local send-transport and producers.
        await this.teardownFileShareSender();
      } else {
        // Viewer, OR server-share host (who joined as consumer): leave the SFU receive room.
        await this.leaveStreamSfu();
      }
    });

    // File Share: host paused/resumed — update the pause indicator for viewers.
    hubConnection.on('fileSharePlayPause', (isPlaying: boolean) => {
      this.fileShareIsPaused.next(!isPlaying);
    });

    // RTMP File Share: stream started — all room members receive this.
    hubConnection.on('rtmpFileShareStarted', (streamerId: string, username: string, roomId: string, streamUrl: string, durationSec: number | null) => {
      this.isPreparingRtmpFileShareHost = false;
      this.pendingRtmpFileShareFile.next(null);
      this.rtmpFileShareActive.next({streamerId, username, streamUrl, durationSec});
      this.rtmpFileShareIsPaused.next(false);
      this.rtmpFileSharePosition.next(0);
      this.rtmpFileShareCanSeek.next(false);
      this.rtmpFileShareVodPlayback.next(null);
    });

    // RTMP File Share: stream stopped — clear all state.
    hubConnection.on('rtmpFileShareStopped', () => {
      const skipCleanup = this._rtmpShareStopInProgress;
      this._rtmpShareStopInProgress = false;
      this.isRtmpFileShareHost = false;
      this.isPreparingRtmpFileShareHost = false;
      this.pendingRtmpFileShareFile.next(null);
      this.rtmpFileShareUploadProgress.next(0);
      this.rtmpFileShareBackgroundUploadInProgress.next(false);
      this._rtmpShareFileDuration = null;
      this._rtmpShareUploadId = null;
      this.rtmpFileShareActive.next(null);
      this.rtmpFileShareIsPaused.next(false);
      this.rtmpFileSharePosition.next(0);
      this.rtmpFileShareCanSeek.next(false);
      this.rtmpFileShareVodPlayback.next(null);
    });

    // RTMP File Share: host paused/resumed.
    hubConnection.on('rtmpFileSharePlayPause', (isPlaying: boolean, positionSec: number) => {
      this.rtmpFileShareIsPaused.next(!isPlaying);
      this.rtmpFileSharePosition.next(positionSec);
    });

    // RTMP File Share: host seeked — fire signal so viewers reconnect their player.
    hubConnection.on('rtmpFileShareSeek', (positionSec: number) => {
      this.rtmpFileSharePosition.next(positionSec);
      this.rtmpFileShareSeekSignal.next(positionSec);
    });

    // RTMP File Share: periodic position tick from the server.
    hubConnection.on('rtmpFileSharePosition', (positionSec: number) => {
      if (!this.rtmpFileShareIsPaused.value) {
        this.rtmpFileSharePosition.next(positionSec);
      }
    });

    hubConnection.on('rtmpFileShareMetadata', (durationSec: number | null, canSeek: boolean) => {
      const active = this.rtmpFileShareActive.value;
      if (active) {
        this.rtmpFileShareActive.next({
          ...active,
          durationSec: durationSec ?? active.durationSec ?? null
        });
      }
      this.rtmpFileShareCanSeek.next(canSeek);
    });

    hubConnection.on('rtmpFileShareStreamReady', (positionSec: number) => {
      this.rtmpFileSharePosition.next(positionSec);
      this.rtmpFileShareStreamReady.next(positionSec);
    });

    hubConnection.on('rtmpFileShareVodReady', (playbackUrl: string, durationSec: number | null, contentType: string | null) => {
      const active = this.rtmpFileShareActive.value;
      if (active) {
        this.rtmpFileShareActive.next({
          ...active,
          durationSec: durationSec ?? active.durationSec ?? null
        });
      }
      this.rtmpFileShareCanSeek.next(true);
      this.rtmpFileShareVodPlayback.next({playbackUrl, durationSec, contentType});
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
    hubConnection.off('rtmpFileShareStarted');
    hubConnection.off('rtmpFileShareStopped');
    hubConnection.off('rtmpFileSharePlayPause');
    hubConnection.off('rtmpFileShareSeek');
    hubConnection.off('rtmpFileSharePosition');
    hubConnection.off('rtmpFileShareMetadata');
    hubConnection.off('rtmpFileShareStreamReady');
    hubConnection.off('rtmpFileShareVodReady');
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
    preferredFrameRate?: number,
    contentPreference: StreamContentPreference = 'motion'
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
        ? this.buildVideoProducerOptions(track, maxBitrate, preferredResolution, preferredFrameRate, contentPreference)
        : this.buildAudioProducerOptions(track);
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
  public async startFileShare(
    roomId: string,
    stream: MediaStream,
    maxBitrate?: number,
    preferredResolution?: number,
    preferredFrameRate: number = 60
  ): Promise<void> {
    if (!token) return;
    const bitrate = maxBitrate ?? 8_000_000;
    this.isFileShareHost = true;
    try {
      await this.startSfuSendTransportOnly(roomId, stream, bitrate, preferredResolution, preferredFrameRate, 'motion');
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
    const wasServerShare = this.isServerFileShare;
    const wasPreparing   = this.isPreparingFileShareHost;

    // Immediately flip all flags — the background upload loop checks isFileShareHost and exits.
    this.isFileShareHost          = false;
    this.isServerFileShare        = false;
    this.isPreparingFileShareHost = false;
    this.pendingFileShareFile.next(null);
    this.fileShareUploadProgress.next(0);
    this.backgroundUploadInProgress.next(false);
    this._serverShareFileDuration = null;

    if (wasPreparing && !wasServerShare) {
      // Stream never started — user cancelled during upload.
      // Cancel the upload session on the server if one was created.
      const uploadId = this._serverShareUploadId;
      this._serverShareUploadId = null;
      if (uploadId) {
        const cancelUrl =
          `${baseUrl}api/video/roomUpload/cancel` +
          `?token=${encodeURIComponent(token)}` +
          `&uploadId=${encodeURIComponent(uploadId)}`;
        this.http.delete(cancelUrl).toPromise().catch(() => {});
      }
      this.fileShareActive.next(null);
      this.fileShareIsPaused.next(false);
      return;
    }

    this._serverShareUploadId = null;
    this.fileShareStopInProgress = true;
    await hubConnection.invoke('StopFileShare', token, roomId)
      .catch(err => console.error('StopFileShare failed:', err));
    await this.teardownFileShareSender(roomId);
    if (wasServerShare) {
      await this.leaveStreamSfu();
    }
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

  /**
   * Seeks the server-side file share to the given position.
   * No-op for browser-captureStream shares.
   */
  public async broadcastFileShareSeek(roomId: string, positionSec: number): Promise<void> {
    if (!token) return;
    await hubConnection.invoke('FileShareSeek', token, roomId, positionSec)
      .catch(err => console.error('FileShareSeek failed:', err));
  }

  /**
   * Duration (seconds) of the file currently being shared via the server path.
   * Null when unknown (probe failed or no server share active).
   */
  get serverShareFileDuration(): number | null {
    return this._serverShareFileDuration;
  }

  /**
   * Starts a server-side file share for an already-uploaded file.
   * Sets `isFileShareHost` and `isServerFileShare` so the `fileShareStarted`
   * notification causes the host to join the SFU as a consumer (not a sender).
   */
  public async startServerFileShare(roomId: string, fileKey: string): Promise<void> {
    if (!token) return;
    this.isFileShareHost  = true;
    this.isServerFileShare = true;
    try {
      await hubConnection.invoke('StartServerFileShare', token, roomId, fileKey);
      this.isPreparingFileShareHost = false;
      this.pendingFileShareFile.next(null);
    } catch (err) {
      this.isFileShareHost   = false;
      this.isServerFileShare = false;
      this.isPreparingFileShareHost = false;
      this.pendingFileShareFile.next(null);
      throw err;
    }
  }

  /**
   * Early-stream server share: uploads the first chunk, starts ffmpeg on the partial file,
   * then continues uploading the remainder in the background while viewers already watch.
   * Resolves once the stream is live; background upload runs concurrently until complete.
   */
  /** Resolves the media duration of a File using a temporary video element. Returns null if undetectable. */
  private probeFileDuration(file: File): Promise<number | null> {
    return new Promise(resolve => {
      const url = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.preload = 'metadata';
      // Null handlers BEFORE touching src so the error triggered by src='' in cleanup doesn't re-enter.
      const cleanup = () => {
        video.onloadedmetadata = null;
        video.onerror = null;
        URL.revokeObjectURL(url);
        video.src = '';
      };
      // Safety timeout: some containers (e.g. MKV on Chrome) fire neither loadedmetadata nor error.
      const fallback = setTimeout(() => { cleanup(); resolve(null); }, 4000);
      video.onloadedmetadata = () => {
        clearTimeout(fallback);
        const dur = isFinite(video.duration) && video.duration > 0 ? video.duration : null;
        cleanup();
        resolve(dur);
      };
      video.onerror = () => { clearTimeout(fallback); cleanup(); resolve(null); };
      video.src = url;
    });
  }

  public async beginServerFileShare(file: File, roomId: string): Promise<void> {
    if (!token) throw new Error('Not authenticated');
    this.fileShareUploadProgress.next(0);
    // Probe duration in the background — does NOT block the upload.
    this.probeFileDuration(file).then(d => { this._serverShareFileDuration = d; }).catch(() => {});

    const dotIdx = file.name.lastIndexOf('.');
    const ext  = dotIdx >= 0 ? file.name.slice(dotIdx) : '';
    const name = dotIdx >= 0 ? file.name.slice(0, dotIdx) : file.name;

    const startUrl =
      `${baseUrl}api/video/roomUpload/start` +
      `?token=${encodeURIComponent(token)}` +
      `&uniqueId=${encodeURIComponent(roomId)}` +
      `&name=${encodeURIComponent(name)}` +
      `&fileEnding=${encodeURIComponent(ext)}` +
      `&totalSize=${file.size}` +
      `&skipPlaylist=true`;

    const startResult: any = await this.http.post(startUrl, null).toPromise();
    if (!startResult?.uploadId) throw new Error('Upload start failed');

    const uploadId: string  = startResult.uploadId;
    const chunkSize: number = startResult.chunkSize || 8 * 1024 * 1024;
    this._serverShareUploadId = uploadId;

    // Upload the first chunk so ffmpeg has data to start reading immediately.
    const firstChunk = file.slice(0, chunkSize);
    await this.http
      .put(this.chunkUrl(uploadId, 0), firstChunk,
           {headers: {'Content-Type': 'application/octet-stream'}})
      .toPromise();
    this.fileShareUploadProgress.next(Math.min(5, Math.round(firstChunk.size / file.size * 100)));

    if (!this.isPreparingFileShareHost) {
      // User cancelled during the first-chunk upload.
      await this.http.delete(
        `${baseUrl}api/video/roomUpload/cancel?token=${encodeURIComponent(token)}&uploadId=${encodeURIComponent(uploadId)}`
      ).toPromise().catch(() => {});
      this._serverShareUploadId = null;
      throw new Error('Share was cancelled');
    }

    // Start ffmpeg on the partial file — stream goes live for all viewers.
    this.isFileShareHost   = true;
    this.isServerFileShare = true;
    try {
      await hubConnection.invoke('StartServerFileShareFromUpload', token, roomId, uploadId);

      // Guard against the user pressing Stop while the hub call was in flight.
      if (!this.isFileShareHost) {
        await hubConnection.invoke('StopFileShare', token, roomId).catch(() => {});
        this._serverShareUploadId = null;
        throw new Error('Share was cancelled');
      }

      this.isPreparingFileShareHost = false;
      this.pendingFileShareFile.next(null);
    } catch (err) {
      if ((err as any)?.message !== 'Share was cancelled') {
        this.isFileShareHost   = false;
        this.isServerFileShare = false;
      }
      this.isPreparingFileShareHost = false;
      this.pendingFileShareFile.next(null);
      this._serverShareUploadId = null;
      throw err;
    }

    // Upload remaining chunks in the background; isFileShareHost acts as the abort signal.
    this.backgroundUploadInProgress.next(true);
    this.continueServerShareUpload(file, roomId, uploadId, chunkSize, firstChunk.size)
      .catch(() => {}); // errors are already handled inside continueServerShareUpload
  }

  private chunkUrl(uploadId: string, offset: number): string {
    return `${baseUrl}api/video/roomUpload/chunk` +
      `?token=${encodeURIComponent(token!)}` +
      `&uploadId=${encodeURIComponent(uploadId)}` +
      `&startByte=${offset}`;
  }

  private async continueServerShareUpload(
    file: File, _roomId: string, uploadId: string, chunkSize: number, startOffset: number
  ): Promise<void> {
    let offset = startOffset;
    try {
      while (offset < file.size) {
        if (!this.isFileShareHost) return; // share was stopped
        const chunk = file.slice(offset, offset + chunkSize);

        // Retry each chunk up to 3 times with linear back-off to handle transient network blips.
        let success = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await this.http
              .put(this.chunkUrl(uploadId, offset), chunk,
                   {headers: {'Content-Type': 'application/octet-stream'}})
              .toPromise();
            success = true;
            break;
          } catch {
            if (attempt < 2) await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
          }
        }
        if (!success) throw new Error('Failed to upload chunk after 3 attempts');

        if (!this.isFileShareHost) return;
        offset += chunk.size;
        this.fileShareUploadProgress.next(Math.min(99, Math.round(offset / file.size * 100)));
      }

      if (!this.isFileShareHost) return;

      // All bytes written — tell the server the file is complete.
      const completeUrl =
        `${baseUrl}api/video/roomUpload/complete` +
        `?token=${encodeURIComponent(token!)}` +
        `&uploadId=${encodeURIComponent(uploadId)}`;
      await this.http.post(completeUrl, null).toPromise();
      // Notify the hub that the upload is complete so the seek guard is cleared.
      await hubConnection.invoke('MarkFileShareUploadComplete', token, _roomId, uploadId).catch(() => {});
      this.fileShareUploadProgress.next(100);
      this.backgroundUploadInProgress.next(false);
    } catch (err: any) {
      if (!this.isFileShareHost) return; // share was already stopped; ignore
      console.error('[FileShare] Background upload failed:', err);
      this.backgroundUploadInProgress.next(false);
      this.serverShareUploadError.next(
        'The background upload failed. Seeking to the end of the file may not work correctly.'
      );
    }
  }

  // ================================================================
  // RTMP File Share — host uploads file; ffmpeg pushes RTMP; viewers use mpegts.js
  // ================================================================

  get rtmpShareFileDuration(): number | null {
    return this._rtmpShareFileDuration;
  }

  public cancelPreparingRtmpFileShare(): void {
    this.isRtmpFileShareHost = false;
    this.isPreparingRtmpFileShareHost = false;
    this.pendingRtmpFileShareFile.next(null);
    this.rtmpFileShareUploadProgress.next(0);
    this.rtmpFileShareBackgroundUploadInProgress.next(false);
    this._rtmpShareFileDuration = null;
    this._rtmpShareUploadId = null;
    this.rtmpFileShareCanSeek.next(false);
    this.rtmpFileShareVodPlayback.next(null);
    if (!this.rtmpFileShareActive.value) {
      this.rtmpFileShareIsPaused.next(false);
      this.rtmpFileSharePosition.next(0);
      this.rtmpFileShareActive.next(null);
    }
  }

  public requestRtmpFileShareHostUi(file?: File): void {
    if (this.rtmpFileShareActive.value) return;
    this.isPreparingRtmpFileShareHost = true;
    if (file) {
      this.pendingRtmpFileShareFile.next(file);
    }
    this.rtmpFileShareHostRequested.next();
  }

  public clearPendingRtmpFileShareFile(): void {
    this.pendingRtmpFileShareFile.next(null);
  }

  public async probeRtmpFileTracks(file: File): Promise<RtmpLocalMediaProbeResult> {
    const mediaInfoFactory = (await import('mediainfo.js')).default;
    const mediaInfo = await mediaInfoFactory({
      format: 'object',
      full: true,
      locateFile: () => 'assets/mediainfo/MediaInfoModule.wasm'
    });

    try {
      const result: any = await mediaInfo.analyzeData(file.size, (size: number, offset: number) =>
        this.readFileChunk(file, offset, size)
      );
      const tracks: any[] = Array.isArray(result?.media?.track) ? result.media.track : [];
      const audioTracks: RtmpLocalMediaTrack[] = [];
      const subtitleTracks: RtmpLocalMediaTrack[] = [];

      tracks.forEach((track: any) => {
        const type = track?.['@type'];
        if (type === 'Audio') {
          audioTracks.push(this.toRtmpLocalMediaTrack(track, audioTracks.length, false));
        } else if (this.isMediaInfoSubtitleTrack(track)) {
          subtitleTracks.push(this.toRtmpLocalMediaTrack(track, subtitleTracks.length, true));
        }
      });

      return {audioTracks, subtitleTracks};
    } finally {
      mediaInfo.close();
    }
  }

  private readFileChunk(file: File, offset: number, size: number): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file.slice(offset, offset + size));
    });
  }

  private toRtmpLocalMediaTrack(track: any, fallbackOrdinal: number, isSubtitle: boolean): RtmpLocalMediaTrack {
    const ordinal = isSubtitle ? fallbackOrdinal : this.readMediaInfoOrdinal(track, fallbackOrdinal);
    const language = this.readFirstMediaInfoValue(track, ['Language_String3', 'Language_String', 'Language']) || 'und';
    const title = this.readFirstMediaInfoValue(track, ['Title', 'StreamName', 'Name']) || '';
    const codecName = this.normalizeMediaInfoCodecName(
      this.readFirstMediaInfoValue(track, ['Format', 'Format_String', 'Format_Commercial', 'CodecID', 'CodecID_String']) || ''
    );
    const isDefault = this.readMediaInfoFlag(track, ['Default', 'Default_String']);
    const isForced = this.readMediaInfoFlag(track, ['Forced', 'Forced_String']);
    const burnMethod = isSubtitle ? this.getRtmpSubtitleBurnMethod(codecName) : null;
    const parts = [
      `#${ordinal + 1}`,
      language !== 'und' ? language : null,
      codecName || null,
      title || null,
      isForced ? 'forced' : null,
      isDefault ? 'default' : null,
    ].filter(Boolean);

    return {
      ordinal,
      language,
      title,
      codecName,
      isDefault,
      isForced,
      burnMethod,
      burnable: !!burnMethod,
      label: parts.join(' · ')
    };
  }

  private isMediaInfoSubtitleTrack(track: any): boolean {
    if (track?.['@type'] === 'Text') return true;
    if (track?.['@type'] !== 'Image') return false;

    const codecName = this.normalizeMediaInfoCodecName(
      this.readFirstMediaInfoValue(track, ['Format', 'Format_String', 'Format_Commercial', 'CodecID', 'CodecID_String']) || ''
    );
    return this.getRtmpSubtitleBurnMethod(codecName) !== null;
  }

  private readMediaInfoOrdinal(track: any, fallbackOrdinal: number): number {
    const raw = track?.StreamKindPos ?? track?.['@typeorder'];
    const parsed = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed - 1 : fallbackOrdinal;
  }

  private readFirstMediaInfoValue(track: any, keys: string[]): string | null {
    for (const key of keys) {
      const value = track?.[key];
      if (value !== undefined && value !== null && String(value).trim()) {
        return String(value).trim();
      }
    }
    return null;
  }

  private readMediaInfoFlag(track: any, keys: string[]): boolean {
    const value = this.readFirstMediaInfoValue(track, keys)?.toLowerCase();
    return value === 'yes' || value === 'true' || value === '1';
  }

  private normalizeMediaInfoCodecName(codecName: string): string {
    const normalized = codecName.trim().toLowerCase();
    const compact = normalized.replace(/[\s_\-/]/g, '');
    if (compact.includes('pgs') || compact.includes('hdmv')) return 'hdmv_pgs_subtitle';
    if (compact.includes('vobsub') || compact.includes('dvdsubtitle') || compact.includes('dvdsub')) return 'dvd_subtitle';
    if (compact.includes('dvbsubtitle') || compact.includes('dvbsub')) return 'dvb_subtitle';
    if (compact.includes('xsub')) return 'xsub';
    if (compact.includes('ass')) return 'ass';
    if (compact.includes('ssa')) return 'ssa';
    if (compact.includes('webvtt') || compact.includes('vtt')) return 'webvtt';
    if (compact.includes('movtext') || compact.includes('tx3g')) return 'mov_text';
    if (compact.includes('subrip') || compact.includes('srt') || compact.includes('utf8')) return 'subrip';
    if (compact.includes('text')) return 'text';
    return normalized;
  }

  private getRtmpSubtitleBurnMethod(codecName: string): RtmpSubtitleBurnMethod | null {
    if (['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text'].includes(codecName)) {
      return 'text';
    }
    if (['hdmv_pgs_subtitle', 'pgs', 'dvd_subtitle', 'dvdsub', 'vobsub', 'xsub', 'dvb_subtitle'].includes(codecName)) {
      return 'bitmap';
    }
    return null;
  }

  /**
   * Uploads the first chunk, tells the server to start ffmpeg (RTMP push),
   * then continues uploading in the background while the stream is live.
   * The manager retries ffmpeg automatically if it exits quickly (e.g. MP4
   * with moov-at-end not yet uploaded), so the stream comes up once enough
   * of the file is on disk.
   */
  public async beginRtmpFileShare(
    file: File,
    roomId: string,
    playbackPreferences: RtmpPlaybackPreferences
  ): Promise<void> {
    if (!token) throw new Error('Not authenticated');
    this.rtmpFileShareUploadProgress.next(0);
    this.probeFileDuration(file).then(d => { this._rtmpShareFileDuration = d; }).catch(() => {});
    this.rtmpFileShareCanSeek.next(false);
    this.rtmpFileShareVodPlayback.next(null);

    const dotIdx = file.name.lastIndexOf('.');
    const ext  = dotIdx >= 0 ? file.name.slice(dotIdx) : '';
    const name = dotIdx >= 0 ? file.name.slice(0, dotIdx) : file.name;

    const startUrl =
      `${baseUrl}api/video/roomUpload/start` +
      `?token=${encodeURIComponent(token)}` +
      `&uniqueId=${encodeURIComponent(roomId)}` +
      `&name=${encodeURIComponent(name)}` +
      `&fileEnding=${encodeURIComponent(ext)}` +
      `&totalSize=${file.size}` +
      `&skipPlaylist=true`;

    const startResult: any = await this.http.post(startUrl, null).toPromise();
    if (!startResult?.uploadId) throw new Error('Upload start failed');

    const uploadId: string  = startResult.uploadId;
    const chunkSize: number = startResult.chunkSize || 8 * 1024 * 1024;
    this._rtmpShareUploadId = uploadId;

    // Upload the first chunk so the server has data to start ffmpeg.
    const firstChunk = file.slice(0, chunkSize);
    await this.http
      .put(this.chunkUrl(uploadId, 0), firstChunk,
           {headers: {'Content-Type': 'application/octet-stream'}})
      .toPromise();
    this.rtmpFileShareUploadProgress.next(Math.min(5, Math.round(firstChunk.size / file.size * 100)));

    if (!this.isPreparingRtmpFileShareHost) {
      await this.http.delete(
        `${baseUrl}api/video/roomUpload/cancel?token=${encodeURIComponent(token)}&uploadId=${encodeURIComponent(uploadId)}`
      ).toPromise().catch(() => {});
      this._rtmpShareUploadId = null;
      throw new Error('Share was cancelled');
    }

    this.isRtmpFileShareHost = true;
    try {
      await hubConnection.invoke('StartRtmpFileShareFromUpload', token, roomId, uploadId, playbackPreferences);

      if (!this.isRtmpFileShareHost) {
        await hubConnection.invoke('StopRtmpFileShare', token, roomId).catch(() => {});
        this._rtmpShareUploadId = null;
        throw new Error('Share was cancelled');
      }

      this.isPreparingRtmpFileShareHost = false;
      this.pendingRtmpFileShareFile.next(null);
    } catch (err) {
      if ((err as any)?.message !== 'Share was cancelled') {
        this.isRtmpFileShareHost = false;
      }
      this.isPreparingRtmpFileShareHost = false;
      this.pendingRtmpFileShareFile.next(null);
      this._rtmpShareUploadId = null;
      throw err;
    }

    // Upload remaining chunks in background; manager retries ffmpeg as needed.
    this.rtmpFileShareBackgroundUploadInProgress.next(true);
    this.continueRtmpShareUpload(file, roomId, uploadId, chunkSize, firstChunk.size)
      .catch(() => {});
  }

  private async continueRtmpShareUpload(
    file: File, roomId: string, uploadId: string, chunkSize: number, startOffset: number
  ): Promise<void> {
    let offset = startOffset;
    try {
      while (offset < file.size) {
        if (!this.isRtmpFileShareHost) return;
        const chunk = file.slice(offset, offset + chunkSize);
        let success = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await this.http
              .put(this.chunkUrl(uploadId, offset), chunk,
                   {headers: {'Content-Type': 'application/octet-stream'}})
              .toPromise();
            success = true;
            break;
          } catch {
            if (attempt < 2) await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
          }
        }
        if (!success) throw new Error('Failed to upload chunk after 3 attempts');
        if (!this.isRtmpFileShareHost) return;
        offset += chunk.size;
        this.rtmpFileShareUploadProgress.next(Math.min(99, Math.round(offset / file.size * 100)));
      }
      if (!this.isRtmpFileShareHost) return;
      const completeUrl =
        `${baseUrl}api/video/roomUpload/complete` +
        `?token=${encodeURIComponent(token!)}` +
        `&uploadId=${encodeURIComponent(uploadId)}`;
      await this.http.post(completeUrl, null).toPromise();
      await hubConnection.invoke('MarkRtmpFileShareUploadComplete', token, roomId, uploadId).catch(() => {});
      this.rtmpFileShareUploadProgress.next(100);
      this.rtmpFileShareBackgroundUploadInProgress.next(false);
    } catch (err: any) {
      if (!this.isRtmpFileShareHost) return;
      console.error('[RtmpFileShare] Background upload failed:', err);
      this.rtmpFileShareBackgroundUploadInProgress.next(false);
      this.rtmpFileShareUploadError.next(
        'The background upload failed. Seeking to the end of the file may not work correctly.'
      );
    }
  }

  public async stopRtmpFileShare(roomId: string): Promise<void> {
    if (!token) return;
    this._rtmpShareStopInProgress = true;
    this.cancelPreparingRtmpFileShare();
    try {
      await hubConnection.invoke('StopRtmpFileShare', token, roomId);
    } catch (err) {
      console.error('StopRtmpFileShare failed:', err);
    }
  }

  public async broadcastRtmpFileSharePlayPause(roomId: string, isPlaying: boolean): Promise<void> {
    if (!token) return;
    await hubConnection.invoke('RtmpFileSharePlayPause', token, roomId, isPlaying)
      .catch(err => console.error('RtmpFileSharePlayPause failed:', err));
  }

  public async broadcastRtmpFileShareSeek(roomId: string, positionSec: number): Promise<void> {
    if (!token) return;
    await hubConnection.invoke('RtmpFileShareSeek', token, roomId, positionSec)
      .catch(err => console.error('RtmpFileShareSeek failed:', err));
  }

  // ================================================================
  // Broadcast (Moderator-only P2P)
  // ================================================================

  /**
   * Starts a moderator broadcast to the room.
   *
   * When the SFU is available (the normal production path) this uses the SFU opt-in
   * stream path so all media is forwarded by the mediasoup server rather than sent
   * peer-to-peer from the broadcaster.  The room is notified via `ForceSfuBroadcast`
   * which causes every client's `broadcastStream` listener to call `startWatching()`;
   * that method detects the active SFU opt-in stream and routes to `startWatchingSfu()`.
   *
   * A P2P fallback is retained for the rare case where the SFU is unreachable.
   */
  public async broadcastToRoom(
    roomId: string,
    stream: MediaStream,
    maxBitrate?: number,
    preferredResolution?: number,
    preferredFrameRate?: number,
    contentPreference: StreamContentPreference = 'motion'
  ): Promise<void> {
    this.localStreamMaxBitrate = maxBitrate ?? 0;
    this.localStreamMaxFrameRate = preferredFrameRate ?? 0;
    this.localStreamContentPreference = contentPreference;
    this.applyStreamContentPreference(stream, contentPreference);
    const canUseSfu = await this.checkSfuAvailable();
    if (canUseSfu) {
      // Set currentRoomId so any teardown path that reads it stays consistent.
      this.currentRoomId = roomId;
      // Set up SFU producers in the opt-in live room (does NOT flip the room player).
      await this.startOptInStreamingSfu(roomId, stream, maxBitrate, preferredResolution, preferredFrameRate, contentPreference);
      // Once producers are ready, push the notification so viewers auto-join via SFU.
      if (token) {
        await hubConnection.invoke('ForceSfuBroadcast', token, roomId)
          .catch(err => console.error('ForceSfuBroadcast failed:', err));
      }
      return;
    }
    // P2P fallback — only reached when the SFU is unreachable.
    this.currentRoomId = roomId;
    this.localStream = stream;
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
   * Computes the maximum available spatial and temporal layer indices from a consumer's
   * RTP parameters.  Handles both VP9 K-SVC (single encoding with scalabilityMode like
   * 'L3T3_KEY') and VP8 simulcast (multiple encodings, each one spatial layer).
   */
  private getMaxPreferredLayers(consumer: mediasoupClient.types.Consumer): {spatial: number; temporal: number} {
    const encodings = consumer.rtpParameters.encodings ?? [];
    if (encodings.length === 0) return {spatial: 0, temporal: 0};
    const firstMode = (encodings[0] as any).scalabilityMode as string | undefined;
    if (firstMode) {
      const match = firstMode.match(/^L(\d+)T(\d+)/);
      if (match) return {spatial: parseInt(match[1], 10) - 1, temporal: parseInt(match[2], 10) - 1};
    }
    // VP8 simulcast: each encoding is one spatial layer; no temporal scalability by default.
    return {spatial: encodings.length - 1, temporal: 0};
  }

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
  expiresAtUnixSec: number;
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

export type StreamContentPreference = 'detail' | 'motion';

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


