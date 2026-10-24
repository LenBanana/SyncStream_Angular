import {Injectable, OnDestroy} from '@angular/core';
import {BehaviorSubject, Subject, Subscription} from 'rxjs';
import {HttpClient, HttpErrorResponse, HttpParams} from '@angular/common/http';
import {SignalRService, hubConnection, baseUrl, logHubFailure} from '../../../services/signal-r.service';
import {SfuService} from '../sfu/sfu.service';
import {ReceivedTrack, SfuLinkState, SfuReceiver, SfuSender} from '../sfu/sfu-transports';
import {liveRoomId, stageRoomId} from '../sfu/sfu-room-ids';
import {musicAudioOptions, VideoEncodingRequest, videoProducerOptions} from '../sfu/sfu-encodings';
import {DialogService} from '../../../text-dialog/text-dialog-service/dialog-service.service';
import {AlertType} from '../../../Interfaces/Dialog';
import {UserlistService} from '../../../userlist/userlist-service/userlist.service';
import {UserUpdate} from '../../../Interfaces/UserUpdate';
import {mp4IndexIsAtEnd} from './mp4-index';

export {StreamContentPreference} from '../sfu/sfu-encodings';

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

/** Who sees a member's stream: the member list (they choose to watch) or the whole room's player. */
export type StreamAudience = 'personal' | 'room';

/**
 * Captured media and how to send it. Whoever ends up owning it calls release() once it is no longer sent,
 * which stops every capture track, including ones the stream no longer carries, such as a microphone mixed into
 * a single audio track.
 */
export interface CapturedMedia {
  stream: MediaStream;
  encoding: VideoEncodingRequest;
  release(): void;
}

/** Where a file the server is streaming has got to. */
export interface ServerFileShareState {
  positionSec: number;
  buffering: boolean;
}

/** A file someone is sharing through RTMP, and the stream it plays from. */
export interface RtmpFileShareInfo {
  streamerId: string;
  username: string;
  streamName: string;
  durationSec: number | null;
}

/** Matches RoomUploadSessionResult on the server. */
interface RoomUploadResponse {
  uploadId?: string;
  chunkSize?: number;
  nextOffset?: number;
  errorMessage?: string;
}

const DEFAULT_UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024;
const UPLOAD_ATTEMPTS = 4;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** The message a refused hub call carries, for showing to the person. */
function describeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // HubException messages arrive wrapped: "An unexpected error occurred invoking 'X' on the server. HubException: …"
  const hubMessage = message.match(/HubException: (.*)$/);
  return hubMessage ? hubMessage[1] : message;
}

@Injectable({
  providedIn: 'root'
})
export class WebrtcService implements OnDestroy {
  // ---------- Watching the room's stage ----------
  /** What the room's stage shows: a broadcast or a file share; null when nothing is coming in. */
  remoteStream = new BehaviorSubject<MediaStream | null>(null);
  /** The stage connection's state, for the player to show reconnecting or failed; null when not watching. */
  stageState = new BehaviorSubject<SfuLinkState | null>(null);

  // ---------- Watching a member's live stream (popout) ----------
  popoutStream = new BehaviorSubject<MediaStream | null>(null);
  popoutState = new BehaviorSubject<SfuLinkState | null>(null);
  /** Whom the popout is showing; null hides it. */
  watchRequest = new BehaviorSubject<{streamerId: string; username: string; roomId: string} | null>(null);
  /** True while the viewer has moved the stream into the browser's Picture-in-Picture window. */
  pipActive = new BehaviorSubject<boolean>(false);

  // ---------- Sending ----------
  /** Where this member's own stream is going; null when not streaming. */
  localAudience = new BehaviorSubject<StreamAudience | null>(null);
  /** The outgoing connection's state while streaming. */
  localState = new BehaviorSubject<SfuLinkState | null>(null);
  /** True while this client is streaming to the room's stage. */
  roomStageBroadcastActive = new BehaviorSubject<boolean>(false);
  /** Local preview of a stage broadcast. */
  roomStagePreviewStream = new BehaviorSubject<MediaStream | null>(null);

  // ---------- Recording ----------
  /** The stage recording in progress, null when none. */
  sfuRecording = new BehaviorSubject<SfuRecordingInfo | null>(null);
  /** The file a stage recording was saved to, as it stops. */
  recordingSaved = new Subject<string>();

  // ---------- File-share state ----------
  /** Emits info about who is sharing a file; null when no share is active. */
  public fileShareActive = new BehaviorSubject<{streamerId: string; username: string} | null>(null);
  /** True when the file-share host has paused playback (used by viewer overlay). */
  public fileShareIsPaused = new BehaviorSubject<boolean>(false);
  /** Position and buffering of a file the server is streaming; null when none. */
  public serverFileShareState = new BehaviorSubject<ServerFileShareState | null>(null);
  /** True when this client is the one sharing the file (local flag only). */
  public isFileShareHost = false;
  /** True when the active share is server-side (ffmpeg→mediasoup); host is also a consumer. */
  public isServerFileShare = false;
  /** True while this client has opened the host file-share UI but has not finished starting the share yet. */
  public isPreparingFileShareHost = false;
  /** File selected in the side-nav and waiting for the host player to start streaming it. */
  public pendingFileShareFile = new BehaviorSubject<File | null>(null);
  /** Upload progress (0-100) while uploading a file for server-side streaming; 0 when idle. */
  public fileShareUploadProgress = new BehaviorSubject<number>(0);
  /** True while the background chunk upload is still running after the stream has gone live. */
  public backgroundUploadInProgress = new BehaviorSubject<boolean>(false);
  /** Emits an error message if the background upload fails unrecoverably. */
  public serverShareUploadError = new Subject<string>();
  /** Fires when the local user picks a file to share; the media component switches to the file share player. */
  public fileShareHostRequested = new Subject<void>();
  private _serverShareUploadId: string | null = null;
  private _serverShareFileDuration: number | null = null;

  // ---------- RTMP file-share state ----------
  /** Who is sharing a file through RTMP; null when no such share is active. */
  public rtmpFileShareActive = new BehaviorSubject<RtmpFileShareInfo | null>(null);
  /** True while the sharer has paused. */
  public rtmpFileShareIsPaused = new BehaviorSubject<boolean>(false);
  /** Where the share is, and whether it is waiting for more of the upload. */
  public rtmpFileShareState = new BehaviorSubject<ServerFileShareState>({positionSec: 0, buffering: false});
  /** True once the whole file has been uploaded, which is when seeking works. */
  public rtmpFileShareCanSeek = new BehaviorSubject<boolean>(false);
  /** Fires when the sharer seeks, so players drop what they buffered before the jump. */
  public rtmpFileShareSeekSignal = new Subject<number>();
  /**
   * Counts the share's runs that went live; 0 until the first one does. A pause, a seek, a wait for the upload
   * and a retry each end a run, and the next is a new stream with its own timestamps, so players connect afresh
   * whenever this changes.
   */
  public rtmpFileShareRun = new BehaviorSubject<number>(0);
  /** True when this client is the one sharing the file. */
  public isRtmpFileShareHost = false;
  /** True while this client has opened the RTMP host UI but has not finished starting. */
  public isPreparingRtmpFileShareHost = false;
  /** File selected for RTMP share, waiting for the component to start the upload. */
  public pendingRtmpFileShareFile = new BehaviorSubject<File | null>(null);
  /** Upload progress (0-100) for the RTMP share's upload. */
  public rtmpFileShareUploadProgress = new BehaviorSubject<number>(0);
  /** True while the rest of the file uploads after the share has started. */
  public rtmpFileShareBackgroundUploadInProgress = new BehaviorSubject<boolean>(false);
  /** Fires when "Share File (RTMP)" is clicked; media component switches to RtmpFileShare player. */
  public rtmpFileShareHostRequested = new Subject<void>();
  private _rtmpShareUploadId: string | null = null;

  // ---------- Links ----------
  private stageReceiver: SfuReceiver | null = null;
  private stageRoomId: string | null = null;
  /** Who is on the stage; their stopWebRtcStream ends the stage view. */
  private stageStreamerId: string | null = null;
  private stageSubscriptions: Subscription[] = [];
  private stageOps: Promise<void> = Promise.resolve();

  private watchReceiver: SfuReceiver | null = null;
  private watchSubscriptions: Subscription[] = [];
  private watchOps: Promise<void> = Promise.resolve();

  private sender: SfuSender | null = null;
  private senderSubscription: Subscription | null = null;
  private capture: CapturedMedia | null = null;
  private sendingRoomId: string | null = null;
  /** What the outgoing stream is for, which decides how it is stopped. */
  private sendingAs: 'room' | 'personal' | 'file' | null = null;

  /**
   * The connection the server knows this client's media under. After a reconnect that brings a new connection,
   * the server has already ended everything the old one had, so the links here are orphans.
   */
  private mediaConnectionId: string | null = null;
  /** What to start again once the room has been rejoined after such a reconnect. */
  private resumeAfterRejoin: {roomId: string; audience: StreamAudience; capture: CapturedMedia} | null = null;
  private rewatchAfterRejoin: {roomId: string; streamerId: string; username: string} | null = null;

  constructor(private http: HttpClient,
              private signalRService: SignalRService,
              private sfu: SfuService,
              private dialogService: DialogService,
              userlistService: UserlistService) {
    signalRService.connectionClosed.subscribe(isClosed => {
      if (isClosed === false) {
        this.addListeners();
        this.noticeReplacedConnection();
      }
      if (isClosed === true) {
        this.removeListeners();
      }
    });
    userlistService.addUserFail.subscribe(update => {
      if (update === UserUpdate.Success) void this.resumeAfterRoomJoin();
    });
  }

  ngOnDestroy(): void {
    this.removeListeners();
  }

  private showError(header: string, error: unknown): void {
    this.dialogService.PushDefaultDialog(describeFailure(error), header, AlertType.Danger);
  }

  // ================================================================
  // Watching the stage
  // ================================================================

  /** Serialises stage changes, so a leave and a join arriving together cannot interleave. */
  private queueStageOp(operation: () => Promise<void>): Promise<void> {
    const result = this.stageOps.then(operation);
    this.stageOps = result.catch(err => console.error('[WebRTC] stage change failed', err));
    return result;
  }

  private joinStage(roomId: string): Promise<void> {
    return this.queueStageOp(async () => {
      if (this.stageReceiver && this.stageRoomId === roomId) return;
      await this.closeStageReceiver();

      const receiver = this.sfu.createReceiver(stageRoomId(roomId));
      this.stageReceiver = receiver;
      this.stageRoomId = roomId;
      this.mediaConnectionId = hubConnection.connectionId;
      this.stageSubscriptions = [
        receiver.tracks.subscribe(tracks => this.remoteStream.next(this.streamOf(this.remoteStream.value, tracks))),
        receiver.state.subscribe(state => this.stageState.next(state))
      ];
      try {
        await receiver.open();
      } catch (err) {
        this.stageState.next('failed');
        throw err;
      }
    });
  }

  private leaveStage(): Promise<void> {
    return this.queueStageOp(() => this.closeStageReceiver());
  }

  private async closeStageReceiver(): Promise<void> {
    const receiver = this.stageReceiver;
    this.stageReceiver = null;
    this.stageRoomId = null;
    this.stageSubscriptions.forEach(subscription => subscription.unsubscribe());
    this.stageSubscriptions = [];
    this.remoteStream.next(null);
    this.stageState.next(null);
    await receiver?.close();
  }

  /** Rebuilds the stage connection, for the player's retry button. */
  public async retryStage(): Promise<void> {
    await this.stageReceiver?.reconnect();
  }

  /**
   * The received tracks as one stream. The same MediaStream is kept while tracks come and go so the player does
   * not restart, and a new one is made once the old one has emptied, which a video element follows reliably.
   */
  private streamOf(current: MediaStream | null, tracks: ReceivedTrack[]): MediaStream | null {
    if (tracks.length === 0) return null;
    const stream = current && current.getTracks().length > 0 ? current : new MediaStream();
    const wanted = new Set(tracks.map(entry => entry.track));
    stream.getTracks().filter(track => !wanted.has(track)).forEach(track => stream.removeTrack(track));
    wanted.forEach(track => {
      if (!stream.getTracks().includes(track)) stream.addTrack(track);
    });
    return stream;
  }

  // ================================================================
  // Sending: one outgoing stream at a time
  // ================================================================

  private async startSending(roomId: string, sfuRoomId: string, capture: CapturedMedia,
                             as: 'room' | 'personal' | 'file'): Promise<void> {
    const sender = this.sfu.createSender(sfuRoomId);
    this.sender = sender;
    this.capture = capture;
    this.sendingRoomId = roomId;
    this.sendingAs = as;
    this.mediaConnectionId = hubConnection.connectionId;
    this.senderSubscription = sender.state.subscribe(state => {
      this.localState.next(state);
      if (state === 'failed') void this.onSendingFailed();
    });

    await sender.open();
    const codecs = await this.sfu.sendableCodecs();
    const video = capture.stream.getVideoTracks()[0];
    const audio = capture.stream.getAudioTracks()[0];
    if (video) {
      await sender.produce('video', videoProducerOptions(video, codecs, capture.encoding));
      // The browser's own "stop sharing" button ends the track; the stream ends with it.
      video.addEventListener('ended', () => {
        if (this.capture === capture) void this.stopOwnStream();
      });
    }
    if (audio) await sender.produce('audio', musicAudioOptions(audio));
  }

  /** Closes the outgoing link and releases the capture. */
  private async stopSending(releaseCapture = true): Promise<void> {
    const sender = this.sender;
    const capture = this.capture;
    this.sender = null;
    this.capture = null;
    this.sendingRoomId = null;
    this.sendingAs = null;
    this.senderSubscription?.unsubscribe();
    this.senderSubscription = null;
    this.localState.next(null);
    this.localAudience.next(null);
    this.roomStagePreviewStream.next(null);
    this.roomStageBroadcastActive.next(false);
    await sender?.close();
    if (releaseCapture) capture?.release();
  }

  private async onSendingFailed(): Promise<void> {
    const roomId = this.sendingRoomId;
    if (!roomId) return;
    this.dialogService.PushDefaultDialog(
      'The connection to the media server could not be restored, so your stream has stopped.',
      'Stream stopped', AlertType.Danger);
    await this.stopOwnStream();
  }

  /** Ends whatever this client is streaming, however it was started. */
  public async stopOwnStream(): Promise<void> {
    const roomId = this.sendingRoomId;
    if (!roomId) return;
    switch (this.sendingAs) {
      case 'room':
        await this.stopStreamingToRoom(roomId);
        break;
      case 'personal':
        await this.stopStreaming(roomId);
        break;
      case 'file':
        await this.stopFileShare(roomId);
        break;
    }
  }

  private async requireMediaServer(): Promise<void> {
    const available = await hubConnection.invoke<boolean>('IsSfuAvailable');
    if (!available) throw new Error('The media server is not reachable right now. Try again in a moment.');
  }

  /** Streams to the member list (opt-in viewers) or to the whole room's player. */
  public async startLive(roomId: string, capture: CapturedMedia, audience: StreamAudience): Promise<void> {
    if (audience === 'room') await this.startStreamingToRoom(roomId, capture);
    else await this.startStreaming(roomId, capture);
  }

  /** Begins a member-list live stream that viewers opt into. */
  public async startStreaming(roomId: string, capture: CapturedMedia): Promise<void> {
    await this.stopOwnStream();
    await this.requireMediaServer();
    const sfuRoomId = await hubConnection.invoke<string>('StartSfuOptInStream', roomId);
    try {
      await this.startSending(roomId, sfuRoomId, capture, 'personal');
    } catch (err) {
      await this.stopSending(false);
      await hubConnection.invoke('StopSfuOptInStream', roomId).catch(logHubFailure);
      throw err;
    }
    this.localAudience.next('personal');
  }

  public async stopStreaming(roomId: string): Promise<void> {
    if (this.sendingAs !== 'personal') return;
    await hubConnection.invoke('StopSfuOptInStream', roomId).catch(logHubFailure);
    await this.stopSending();
  }

  /** Takes the room's stage: everyone's player switches to this stream. */
  public async startStreamingToRoom(roomId: string, capture: CapturedMedia): Promise<void> {
    await this.stopOwnStream();
    await this.requireMediaServer();
    // The stage is claimed before anything is sent: nobody can send into it without holding it.
    await hubConnection.invoke('StartSfuStream', roomId);
    try {
      await this.startSending(roomId, stageRoomId(roomId), capture, 'room');
    } catch (err) {
      await this.stopSending(false);
      await hubConnection.invoke('StopSfuStream', roomId).catch(logHubFailure);
      throw err;
    }
    this.localAudience.next('room');
    this.roomStagePreviewStream.next(capture.stream);
    this.roomStageBroadcastActive.next(true);
  }

  public async stopStreamingToRoom(roomId: string): Promise<void> {
    if (this.sendingAs !== 'room') return;
    await hubConnection.invoke('StopSfuStream', roomId).catch(logHubFailure);
    await this.stopSending();
  }

  /**
   * Everything ends when leaving a room: whatever this client streams or shares, and whatever it watches. The
   * server does the same when it sees the member leave, so this is about the local side being tidy.
   */
  public async leaveRoom(roomId: string): Promise<void> {
    this.resumeAfterRejoin = null;
    this.rewatchAfterRejoin = null;
    await this.stopOwnStream();
    if (this.isPreparingFileShareHost || this.isFileShareHost) await this.stopFileShare(roomId);
    if (this.isRtmpFileShareHost) await this.stopRtmpFileShare(roomId);
    else if (this.isPreparingRtmpFileShareHost) this.cancelPreparingRtmpFileShare();
    await this.closeWatch();
    await this.leaveStage();
    this.resetSharedState();
    this.mediaConnectionId = null;
  }

  private resetSharedState(): void {
    this.stageStreamerId = null;
    this.sfuRecording.next(null);
    this.fileShareActive.next(null);
    this.fileShareIsPaused.next(false);
    this.serverFileShareState.next(null);
    this.isFileShareHost = false;
    this.isServerFileShare = false;
    this.isPreparingFileShareHost = false;
    this.pendingFileShareFile.next(null);
  }

  // ================================================================
  // Watching a member's live stream in the popout
  // ================================================================

  private queueWatchOp(operation: () => Promise<void>): Promise<void> {
    const result = this.watchOps.then(operation);
    this.watchOps = result.catch(err => console.error('[WebRTC] popout change failed', err));
    return result;
  }

  public startWatching(roomId: string, streamerId: string, username: string): Promise<void> {
    return this.queueWatchOp(async () => {
      await this.closeWatchReceiver();
      this.watchRequest.next({streamerId, username, roomId});

      const receiver = this.sfu.createReceiver(liveRoomId(roomId, streamerId));
      this.watchReceiver = receiver;
      this.mediaConnectionId = hubConnection.connectionId;
      this.watchSubscriptions = [
        receiver.tracks.subscribe(tracks => this.popoutStream.next(this.streamOf(this.popoutStream.value, tracks))),
        receiver.state.subscribe(state => this.popoutState.next(state))
      ];
      try {
        await receiver.open();
      } catch (err) {
        await this.closeWatchReceiver();
        this.watchRequest.next(null);
        this.showError(`Could not watch ${username || 'this stream'}`, err);
      }
    });
  }

  /** Stop watching the current stream and dismiss the popout. */
  public stopWatching(): void {
    void this.closeWatch();
  }

  private closeWatch(): Promise<void> {
    return this.queueWatchOp(async () => {
      await this.closeWatchReceiver();
      this.watchRequest.next(null);
      this.pipActive.next(false);
    });
  }

  private async closeWatchReceiver(): Promise<void> {
    const receiver = this.watchReceiver;
    this.watchReceiver = null;
    this.watchSubscriptions.forEach(subscription => subscription.unsubscribe());
    this.watchSubscriptions = [];
    this.popoutStream.next(null);
    this.popoutState.next(null);
    await receiver?.close();
  }

  /** Rebuilds the popout connection, for its retry button. */
  public async retryWatching(): Promise<void> {
    await this.watchReceiver?.reconnect();
  }

  // ================================================================
  // Reconnecting
  // ================================================================

  /**
   * Called when the hub connection is back. If it is a new connection, the server has already ended everything the
   * old one was doing, so the links here are dropped, and what was being sent or watched is remembered to start
   * again once the room has been rejoined. A connection that resumed (same id) needs nothing.
   */
  private noticeReplacedConnection(): void {
    if (!this.mediaConnectionId || hubConnection.connectionId === this.mediaConnectionId) return;

    const roomId = this.sendingRoomId;
    if (roomId && this.capture && (this.sendingAs === 'room' || this.sendingAs === 'personal')) {
      this.resumeAfterRejoin = {roomId, audience: this.sendingAs, capture: this.capture};
    }
    const watching = this.watchRequest.value;
    if (watching) this.rewatchAfterRejoin = {...watching};

    const wasSharingFile = this.sendingAs === 'file' || this.isFileShareHost || this.isRtmpFileShareHost;
    void this.stopSending(this.resumeAfterRejoin === null);
    void this.closeWatch();
    void this.leaveStage();
    this.resetSharedState();
    this.mediaConnectionId = null;

    if (wasSharingFile) {
      this.dialogService.PushDefaultDialog(
        'The connection to the server was lost, so the file share ended. Share it again to continue.',
        'File share ended', AlertType.Warning);
    }
    if (this.isRtmpFileShareHost || this.isPreparingRtmpFileShareHost) {
      this.cancelPreparingRtmpFileShare();
      this.resetRtmpState();
    }
  }

  /** After rejoining the room, starts again what the lost connection was sending and watching. */
  private async resumeAfterRoomJoin(): Promise<void> {
    const resume = this.resumeAfterRejoin;
    const rewatch = this.rewatchAfterRejoin;
    this.resumeAfterRejoin = null;
    this.rewatchAfterRejoin = null;

    if (resume) {
      const live = resume.capture.stream.getVideoTracks().some(track => track.readyState === 'live');
      if (!live) {
        resume.capture.release();
      } else {
        try {
          await this.startLive(resume.roomId, resume.capture, resume.audience);
        } catch (err) {
          resume.capture.release();
          this.showError('Your stream could not be resumed', err);
        }
      }
    }
    if (rewatch) await this.startWatching(rewatch.roomId, rewatch.streamerId, rewatch.username);
  }

  // ================================================================
  // SignalR listeners
  // ================================================================

  private addListeners(): void {
    // Someone took the room's stage: everyone else's player shows it.
    hubConnection.on('startSfuStream', (roomId: string, streamerId: string) => {
      this.stageStreamerId = streamerId;
      this.joinStage(roomId).catch(err => this.showError('Could not show the broadcast', err));
    });

    // A broadcast or a member-list live stream ended.
    hubConnection.on('stopWebRtcStream', (streamerId: string) => {
      if (streamerId === this.stageStreamerId) {
        this.stageStreamerId = null;
        this.sfuRecording.next(null);
        void this.leaveStage();
      }
      if (streamerId === this.watchRequest.value?.streamerId) void this.closeWatch();
    });

    hubConnection.on('sfuRecordingStarted', (info: SfuRecordingInfo) => {
      this.sfuRecording.next(info);
    });

    hubConnection.on('sfuRecordingStopped', (_roomId: string, filename: string) => {
      this.sfuRecording.next(null);
      if (filename) this.recordingSaved.next(filename);
    });

    // File Share: a room member started sharing a file to the stage. Everyone but a browser sharer watches it
    // through the stage; a server share's sharer watches it too, since the server is the one sending.
    hubConnection.on('fileShareStarted', (streamerId: string, username: string, roomId: string) => {
      this.isPreparingFileShareHost = false;
      this.pendingFileShareFile.next(null);
      this.fileShareActive.next({streamerId, username});
      this.fileShareIsPaused.next(false);
      this.serverFileShareState.next(null);
      if (!this.isFileShareHost || this.isServerFileShare) {
        this.joinStage(roomId).catch(err => this.showError('Could not show the shared file', err));
      }
    });

    // File Share: the active share ended.
    hubConnection.on('fileShareStopped', () => {
      const wasBrowserHost = this.sendingAs === 'file';
      this.isFileShareHost = false;
      this.isServerFileShare = false;
      this.isPreparingFileShareHost = false;
      this.pendingFileShareFile.next(null);
      this.fileShareUploadProgress.next(0);
      this.backgroundUploadInProgress.next(false);
      this._serverShareFileDuration = null;
      this._serverShareUploadId = null;
      this.fileShareActive.next(null);
      this.fileShareIsPaused.next(false);
      this.serverFileShareState.next(null);
      if (wasBrowserHost) void this.stopSending();
      void this.leaveStage();
    });

    hubConnection.on('fileSharePlayPause', (isPlaying: boolean) => {
      this.fileShareIsPaused.next(!isPlaying);
    });

    hubConnection.on('serverFileShareState', (positionSec: number, buffering: boolean) => {
      this.serverFileShareState.next({positionSec, buffering});
    });

    // RTMP File Share: a member started sharing a file; everyone's player switches to it and connects once a run
    // of it is live.
    hubConnection.on('rtmpFileShareStarted',
      (streamerId: string, username: string, _roomId: string, streamName: string, durationSec: number | null) => {
        this.isPreparingRtmpFileShareHost = false;
        this.pendingRtmpFileShareFile.next(null);
        this.rtmpFileShareActive.next({streamerId, username, streamName, durationSec});
        this.rtmpFileShareIsPaused.next(false);
        this.rtmpFileShareState.next({positionSec: 0, buffering: false});
        this.rtmpFileShareCanSeek.next(false);
        this.rtmpFileShareRun.next(0);
      });

    hubConnection.on('rtmpFileShareStopped', () => {
      this.resetRtmpState();
    });

    hubConnection.on('rtmpFileSharePlayPause', (isPlaying: boolean, positionSec: number) => {
      this.rtmpFileShareIsPaused.next(!isPlaying);
      this.rtmpFileShareState.next({positionSec, buffering: false});
    });

    hubConnection.on('rtmpFileShareSeek', (positionSec: number) => {
      this.rtmpFileShareState.next({positionSec, buffering: false});
      this.rtmpFileShareSeekSignal.next(positionSec);
    });

    hubConnection.on('rtmpFileShareState', (positionSec: number, buffering: boolean) => {
      this.rtmpFileShareState.next({positionSec, buffering});
    });

    hubConnection.on('rtmpFileShareMetadata', (durationSec: number | null, canSeek: boolean) => {
      const active = this.rtmpFileShareActive.value;
      if (active) this.rtmpFileShareActive.next({...active, durationSec: durationSec ?? active.durationSec});
      this.rtmpFileShareCanSeek.next(canSeek);
    });

    hubConnection.on('rtmpFileShareStreamReady', (positionSec: number) => {
      this.rtmpFileShareState.next({positionSec, buffering: false});
      this.rtmpFileShareRun.next(this.rtmpFileShareRun.value + 1);
    });
  }

  private removeListeners(): void {
    hubConnection.off('startSfuStream');
    hubConnection.off('stopWebRtcStream');
    hubConnection.off('sfuRecordingStarted');
    hubConnection.off('sfuRecordingStopped');
    hubConnection.off('fileShareStarted');
    hubConnection.off('fileShareStopped');
    hubConnection.off('fileSharePlayPause');
    hubConnection.off('serverFileShareState');
    hubConnection.off('rtmpFileShareStarted');
    hubConnection.off('rtmpFileShareStopped');
    hubConnection.off('rtmpFileSharePlayPause');
    hubConnection.off('rtmpFileShareSeek');
    hubConnection.off('rtmpFileShareState');
    hubConnection.off('rtmpFileShareMetadata');
    hubConnection.off('rtmpFileShareStreamReady');
  }

  // ================================================================
  // File Share: the host plays a file and shares it to the stage
  // ================================================================

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

  /**
   * Shares a file the browser can play, from the caller's own player. The caller passes the stream captured from
   * that player.
   */
  public async startFileShare(
    roomId: string,
    stream: MediaStream,
    maxBitrate: number,
    maxHeight: number,
    frameRate: number
  ): Promise<void> {
    await this.stopOwnStream();
    this.isFileShareHost = true;
    try {
      await this.requireMediaServer();
      // Claimed first: the stage only accepts tracks from whoever holds it.
      await hubConnection.invoke('StartFileShare', roomId);
      const capture: CapturedMedia = {
        stream,
        encoding: {maxBitrate, maxHeight, frameRate, contentPreference: 'motion'},
        release: () => stream.getTracks().forEach(track => track.stop())
      };
      await this.startSending(roomId, stageRoomId(roomId), capture, 'file');
      this.isPreparingFileShareHost = false;
      this.pendingFileShareFile.next(null);
    } catch (err) {
      await this.stopSending();
      await hubConnection.invoke('StopFileShare', roomId).catch(logHubFailure);
      this.isFileShareHost = false;
      this.isPreparingFileShareHost = false;
      this.pendingFileShareFile.next(null);
      this.showError('The file could not be shared', err);
      throw err;
    }
  }

  /** Stops the active file share, whichever way it was being shared. */
  public async stopFileShare(roomId: string): Promise<void> {
    const wasServerShare = this.isServerFileShare;
    const wasPreparing = this.isPreparingFileShareHost;

    // Flipped first: the background upload loop checks isFileShareHost and exits.
    this.isFileShareHost = false;
    this.isServerFileShare = false;
    this.isPreparingFileShareHost = false;
    this.pendingFileShareFile.next(null);
    this.fileShareUploadProgress.next(0);
    this.backgroundUploadInProgress.next(false);
    this._serverShareFileDuration = null;

    const uploadId = this._serverShareUploadId;
    this._serverShareUploadId = null;

    if (wasPreparing && !this.fileShareActive.value) {
      // The share never started; only the upload has to go.
      if (uploadId) await this.cancelUpload(uploadId);
      return;
    }

    await hubConnection.invoke('StopFileShare', roomId).catch(logHubFailure);
    if (this.sendingAs === 'file') await this.stopSending();
    if (wasServerShare) await this.leaveStage();
    this.fileShareActive.next(null);
    this.fileShareIsPaused.next(false);
    this.serverFileShareState.next(null);
  }

  /**
   * Broadcast the current play/pause state to all room members.
   * Call this whenever the local <video> element plays or pauses.
   */
  public async broadcastFileSharePlayPause(roomId: string, isPlaying: boolean): Promise<void> {
    await hubConnection.invoke('FileSharePlayPause', roomId, isPlaying)
      .catch(err => this.showError('Could not change playback', err));
  }

  /** Seeks the server-side file share to the given position. */
  public async broadcastFileShareSeek(roomId: string, positionSec: number): Promise<void> {
    await hubConnection.invoke('FileShareSeek', roomId, positionSec)
      .catch(err => this.showError('Could not seek', err));
  }

  /**
   * Duration (seconds) of the file currently being shared via the server path.
   * Null when unknown (probe failed or no server share active).
   */
  get serverShareFileDuration(): number | null {
    return this._serverShareFileDuration;
  }

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

  /**
   * Shares a file the browser cannot play, by uploading it and letting the server stream it. Playback starts as
   * soon as the beginning of the file has arrived and the rest uploads in the background; the server waits
   * whenever playback catches up with the upload.
   */
  public async beginServerFileShare(file: File, roomId: string): Promise<void> {
    this.fileShareUploadProgress.next(0);
    this.probeFileDuration(file).then(duration => this._serverShareFileDuration = duration);

    const waitForWholeFile = await mp4IndexIsAtEnd(file, file.name);
    const {uploadId, chunkSize} = await this.startRoomUpload(file, roomId);
    this._serverShareUploadId = uploadId;

    const progress = (offset: number) =>
      this.fileShareUploadProgress.next(Math.min(99, Math.round(offset / file.size * 100)));
    const startAt = waitForWholeFile ? file.size : Math.min(file.size, chunkSize);
    const reached = await this.uploadRange(file, uploadId, chunkSize, 0, startAt, progress,
      () => this.isPreparingFileShareHost);

    if (!this.isPreparingFileShareHost || reached < startAt) {
      await this.cancelUpload(uploadId);
      this._serverShareUploadId = null;
      throw new Error('Share was cancelled');
    }

    this.isFileShareHost = true;
    this.isServerFileShare = true;
    try {
      await this.requireMediaServer();
      await hubConnection.invoke('StartServerFileShareFromUpload', roomId, uploadId);
      if (!this.isFileShareHost) {
        // Stopped while the hub call was in flight.
        await hubConnection.invoke('StopFileShare', roomId).catch(logHubFailure);
        throw new Error('Share was cancelled');
      }
      this.isPreparingFileShareHost = false;
      this.pendingFileShareFile.next(null);
    } catch (err) {
      const cancelled = err instanceof Error && err.message === 'Share was cancelled';
      this.isFileShareHost = false;
      this.isServerFileShare = false;
      this.isPreparingFileShareHost = false;
      this.pendingFileShareFile.next(null);
      this._serverShareUploadId = null;
      await this.cancelUpload(uploadId);
      if (!cancelled) this.showError('The file could not be shared', err);
      throw err;
    }

    this.backgroundUploadInProgress.next(true);
    this.finishServerShareUpload(file, roomId, uploadId, chunkSize, reached, progress);
  }

  private async finishServerShareUpload(file: File, roomId: string, uploadId: string, chunkSize: number,
                                        from: number, progress: (offset: number) => void): Promise<void> {
    try {
      const reached = await this.uploadRange(file, uploadId, chunkSize, from, file.size, progress,
        () => this.isFileShareHost && this._serverShareUploadId === uploadId);
      if (reached < file.size) return; // the share was stopped
      await hubConnection.invoke('MarkFileShareUploadComplete', roomId, uploadId);
      this.fileShareUploadProgress.next(100);
    } catch (err) {
      if (!this.isFileShareHost) return;
      console.error('[FileShare] Background upload failed:', err);
      this.serverShareUploadError.next(
        'The upload stopped before the end of the file. Viewers can watch up to where it got to.');
    } finally {
      this.backgroundUploadInProgress.next(false);
    }
  }

  // ================================================================
  // Room uploads, shared by the server file share and the RTMP share
  // ================================================================

  private async startRoomUpload(file: File, roomId: string): Promise<{uploadId: string; chunkSize: number}> {
    const dot = file.name.lastIndexOf('.');
    const params = new HttpParams({
      fromObject: {
        uniqueId: roomId,
        name: dot >= 0 ? file.name.slice(0, dot) : file.name,
        fileEnding: dot >= 0 ? file.name.slice(dot) : '',
        totalSize: String(file.size),
        skipPlaylist: 'true'
      }
    });
    const start = await this.http.post<RoomUploadResponse>(`${baseUrl}api/video/roomUpload/start`, null, {params})
      .toPromise();
    if (!start?.uploadId) throw new Error(start?.errorMessage || 'The server did not start the upload.');
    return {uploadId: start.uploadId, chunkSize: start.chunkSize || DEFAULT_UPLOAD_CHUNK_SIZE};
  }

  /**
   * Uploads the bytes from `from` up to `until`, a chunk at a time, while keepGoing() holds. Returns how far it got.
   *
   * A chunk the connection dropped in the middle of is partly written on the server, which then refuses to start
   * the next one anywhere but where it got to. That answer carries the offset, so the upload carries on from
   * there; it used to retry the same offset three times and give up.
   */
  private async uploadRange(file: File, uploadId: string, chunkSize: number, from: number, until: number,
                            progress: (offset: number) => void, keepGoing: () => boolean): Promise<number> {
    let offset = from;
    let failures = 0;
    while (offset < until) {
      if (!keepGoing()) return offset;
      const end = Math.min(offset + chunkSize, file.size);
      const params = new HttpParams({fromObject: {uploadId, startByte: String(offset)}});
      try {
        await this.http.put(`${baseUrl}api/video/roomUpload/chunk`, file.slice(offset, end), {
          params,
          headers: {'Content-Type': 'application/octet-stream'}
        }).toPromise();
        offset = end;
        failures = 0;
        progress(offset);
      } catch (err) {
        const serverOffset = err instanceof HttpErrorResponse && err.status === 409
          ? Number((err.error as RoomUploadResponse | null)?.nextOffset)
          : NaN;
        if (Number.isFinite(serverOffset) && serverOffset !== offset && serverOffset >= 0) {
          offset = serverOffset;
          progress(offset);
          continue;
        }
        if (++failures >= UPLOAD_ATTEMPTS) throw err;
        await sleep(1500 * failures);
      }
    }
    return offset;
  }

  private async cancelUpload(uploadId: string): Promise<void> {
    const params = new HttpParams({fromObject: {uploadId}});
    await this.http.delete(`${baseUrl}api/video/roomUpload/cancel`, {params}).toPromise()
      .catch(err => console.warn('[Upload] cancelling the upload failed', err));
  }

  // ================================================================
  // RTMP File Share: the sharer uploads the file, the server transcodes it and pushes it to the streaming
  // server, and everyone plays it from there with mpegts.js
  // ================================================================

  private resetRtmpState(): void {
    this.cancelPreparingRtmpFileShare();
    this.rtmpFileShareActive.next(null);
    this.rtmpFileShareIsPaused.next(false);
    this.rtmpFileShareState.next({positionSec: 0, buffering: false});
    this.rtmpFileShareRun.next(0);
  }

  /** Drops this client's side of starting or hosting a share; the upload loop sees it and stops. */
  public cancelPreparingRtmpFileShare(): void {
    this.isRtmpFileShareHost = false;
    this.isPreparingRtmpFileShareHost = false;
    this.pendingRtmpFileShareFile.next(null);
    this.rtmpFileShareUploadProgress.next(0);
    this.rtmpFileShareBackgroundUploadInProgress.next(false);
    this._rtmpShareUploadId = null;
    this.rtmpFileShareCanSeek.next(false);
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
   * Shares a file through RTMP. Streaming starts as soon as the beginning of the file has arrived and the rest
   * uploads in the background; the server waits whenever playback catches up with the upload. An MP4 or MOV
   * with its index at the end cannot be played from its beginning alone, so it is uploaded completely first.
   */
  public async beginRtmpFileShare(
    file: File,
    roomId: string,
    playbackPreferences: RtmpPlaybackPreferences
  ): Promise<void> {
    this.rtmpFileShareUploadProgress.next(0);
    this.rtmpFileShareCanSeek.next(false);

    const progress = (offset: number) =>
      this.rtmpFileShareUploadProgress.next(Math.min(99, Math.round(offset / file.size * 100)));
    let uploadId: string;
    let chunkSize: number;
    let startAt: number;
    let reached: number;
    try {
      const waitForWholeFile = await mp4IndexIsAtEnd(file, file.name);
      ({uploadId, chunkSize} = await this.startRoomUpload(file, roomId));
      this._rtmpShareUploadId = uploadId;
      startAt = waitForWholeFile ? file.size : Math.min(file.size, chunkSize);
      reached = await this.uploadRange(file, uploadId, chunkSize, 0, startAt, progress,
        () => this.isPreparingRtmpFileShareHost);
    } catch (err) {
      const startedUpload = this._rtmpShareUploadId;
      this.isPreparingRtmpFileShareHost = false;
      this.pendingRtmpFileShareFile.next(null);
      this._rtmpShareUploadId = null;
      if (startedUpload) await this.cancelUpload(startedUpload);
      this.showError('The file could not be uploaded', err);
      throw err;
    }

    if (!this.isPreparingRtmpFileShareHost || reached < startAt) {
      await this.cancelUpload(uploadId);
      this._rtmpShareUploadId = null;
      throw new Error('Share was cancelled');
    }

    this.isRtmpFileShareHost = true;
    try {
      await hubConnection.invoke('StartRtmpFileShareFromUpload', roomId, uploadId, playbackPreferences);
      if (!this.isRtmpFileShareHost) {
        // Stopped while the hub call was in flight.
        await hubConnection.invoke('StopRtmpFileShare', roomId).catch(logHubFailure);
        throw new Error('Share was cancelled');
      }
      this.isPreparingRtmpFileShareHost = false;
      this.pendingRtmpFileShareFile.next(null);
    } catch (err) {
      const cancelled = err instanceof Error && err.message === 'Share was cancelled';
      this.isRtmpFileShareHost = false;
      this.isPreparingRtmpFileShareHost = false;
      this.pendingRtmpFileShareFile.next(null);
      this._rtmpShareUploadId = null;
      await this.cancelUpload(uploadId);
      if (!cancelled) this.showError('The file could not be shared', err);
      throw err;
    }

    this.rtmpFileShareBackgroundUploadInProgress.next(true);
    void this.finishRtmpShareUpload(file, roomId, uploadId, chunkSize, reached, progress);
  }

  private async finishRtmpShareUpload(file: File, roomId: string, uploadId: string, chunkSize: number,
                                      from: number, progress: (offset: number) => void): Promise<void> {
    try {
      const reached = await this.uploadRange(file, uploadId, chunkSize, from, file.size, progress,
        () => this.isRtmpFileShareHost && this._rtmpShareUploadId === uploadId);
      if (reached < file.size) return; // the share was stopped
      await hubConnection.invoke('MarkRtmpFileShareUploadComplete', roomId, uploadId);
      this.rtmpFileShareUploadProgress.next(100);
    } catch (err) {
      if (!this.isRtmpFileShareHost) return;
      console.error('[RtmpFileShare] Background upload failed:', err);
      this.dialogService.PushDefaultDialog(
        'The upload stopped before the end of the file. Everyone can watch up to where it got to.',
        'Upload stopped', AlertType.Warning);
    } finally {
      this.rtmpFileShareBackgroundUploadInProgress.next(false);
    }
  }

  /** Ends this client's RTMP share, or the start of one that is still uploading its beginning. */
  public async stopRtmpFileShare(roomId: string): Promise<void> {
    const hosting = this.isRtmpFileShareHost && !!this.rtmpFileShareActive.value;
    this.cancelPreparingRtmpFileShare();
    if (hosting) {
      await hubConnection.invoke('StopRtmpFileShare', roomId)
        .catch(err => this.showError('The share could not be stopped', err));
    }
  }

  public async broadcastRtmpFileSharePlayPause(roomId: string, isPlaying: boolean): Promise<void> {
    await hubConnection.invoke('RtmpFileSharePlayPause', roomId, isPlaying)
      .catch(err => this.showError('Could not change playback', err));
  }

  public async broadcastRtmpFileShareSeek(roomId: string, positionSec: number): Promise<void> {
    await hubConnection.invoke('RtmpFileShareSeek', roomId, positionSec)
      .catch(err => this.showError('Could not seek', err));
  }

  // ================================================================
  // Recording the stage
  // ================================================================

  /** Starts recording this client's broadcast to a file on the server. */
  public async startRecording(roomId: string): Promise<void> {
    await hubConnection.invoke('StartRecording', roomId)
      .catch(err => this.showError('Recording could not start', err));
  }

  /** Stops the recording; recordingSaved then carries the file. */
  public async stopRecording(roomId: string): Promise<void> {
    await hubConnection.invoke('StopRecording', roomId)
      .catch(err => this.showError('Recording could not stop', err));
  }
}

// ================================================================
// Interfaces
// ================================================================

export enum Resolution {
  HD = 720,
  FHD = 1080,
  QHD = 1440,
  UHD = 2160
}

/** Matches SfuRecordingInfo on the backend. */
export interface SfuRecordingInfo {
  roomId: string;
  filename: string;
  startedAtUnixMs: number;
}
