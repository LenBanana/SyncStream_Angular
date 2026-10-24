import {Injectable, OnDestroy} from '@angular/core';
import {BehaviorSubject, Subscription} from 'rxjs';
import {skip} from 'rxjs/operators';
import {hubConnection, logHubFailure, SignalRService} from '../../../services/signal-r.service';
import {SfuService} from '../../webrtc/sfu/sfu.service';
import {ReceivedTrack, SfuLinkState, SfuReceiver, SfuSender} from '../../webrtc/sfu/sfu-transports';
import {voiceRoomId} from '../../webrtc/sfu/sfu-room-ids';
import {videoProducerOptions, VideoEncodingRequest, voiceAudioOptions} from '../../webrtc/sfu/sfu-encodings';
import {loadBrowserSettings} from '../../../Interfaces/BrowserSettings';
import {voipJoinAudio, voipLeaveAudio} from '../../../Interfaces/Sounds';
import {DreckchatService} from '../../../dreckchat/dreckchat-service/dreckchat.service';
import {RoomService} from '../../../rooms/rooms-service/rooms.service';
import {UserlistService} from '../../../userlist/userlist-service/userlist.service';
import {UserUpdate} from '../../../Interfaces/UserUpdate';
import {DialogService} from '../../../text-dialog/text-dialog-service/dialog-service.service';
import {AlertType} from '../../../Interfaces/Dialog';

/** Matches VoipParticipantDto on the server. */
export interface VoipParticipantDTO {
  participantId: string;
  participantName?: string;
  isMuted?: boolean;
  isVideoMuted?: boolean;
  isScreenMuted?: boolean;
}

export interface VoipParticipant extends VoipParticipantDTO {
  participantName: string;
  /** Their camera or screen, video only; null while they send none. Their voice plays through the service. */
  stream: MediaStream | null;
  isSpeaking: boolean;
  /** Silenced on this side only. */
  isLocallyMuted: boolean;
}

export type VideoSource = 'webcam' | 'screen';

/** Loudness, on the analyser's 0..1 RMS scale, above which someone counts as speaking. */
const SPEAKING_LEVEL = 0.02;
const METER_INTERVAL_MS = 150;
const CAMERA_ENCODING: VideoEncodingRequest = {maxBitrate: 1_200_000, maxHeight: 720, frameRate: 30, contentPreference: 'motion'};
const SCREEN_ENCODING: VideoEncodingRequest = {maxBitrate: 2_500_000, maxHeight: 1080, frameRate: 30, contentPreference: 'detail'};

/**
 * The room's voice and video call.
 *
 * Runs through the SFU: everyone sends their microphone (and camera or screen) once and receives everyone else.
 * The call used to be a peer-to-peer mesh in which each participant uploaded a copy to every other one, and its
 * signalling let anyone who knew a connection id receive a participant's microphone without joining.
 *
 * The call belongs to this service rather than to the component that shows it, so switching the room to a game,
 * which removes that component, no longer ends it. Remote voices play through audio elements owned here for the
 * same reason.
 */
@Injectable({
  providedIn: 'root'
})
export class WebrtcVoipService implements OnDestroy {
  /** Everyone else in the call. */
  readonly participants = new BehaviorSubject<VoipParticipant[]>([]);
  /** This client in the call; null when not in one. */
  readonly local = new BehaviorSubject<VoipParticipant | null>(null);
  /** The worse of the sending and receiving connections, for the call UI. */
  readonly callState = new BehaviorSubject<SfuLinkState | null>(null);
  /** The room whose call was joined, as it is joined. */
  readonly joinRoom = new BehaviorSubject<string>(null);
  /** The room whose call was left, as it is left. */
  readonly leaveRoom = new BehaviorSubject<string>(null);

  private roomId: string | null = null;
  private localStream: MediaStream | null = null;
  private videoSource: VideoSource | null = null;
  private sender: SfuSender | null = null;
  private receiver: SfuReceiver | null = null;
  private linkSubscriptions: Subscription[] = [];
  private readonly audioElements = new Map<string, HTMLAudioElement>();
  private readonly meters = new Map<string, {source: MediaStreamAudioSourceNode; analyser: AnalyserNode; track: MediaStreamTrack}>();
  private meterContext: AudioContext | null = null;
  private meterTimer: ReturnType<typeof setInterval> | null = null;
  /** The connection the server knows this call under; see WebrtcService for why that matters. */
  private callConnectionId: string | null = null;
  private rejoinAfterReconnect: {roomId: string; muted: boolean} | null = null;
  private busy: Promise<void> = Promise.resolve();

  constructor(signalRService: SignalRService,
              private sfu: SfuService,
              private dialogService: DialogService,
              chatService: DreckchatService,
              roomService: RoomService,
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

    // The voice button in chat toggles the call of its room. skip(1): the subject replays its last value.
    chatService.joinVoice.pipe(skip(1)).subscribe(roomId => {
      if (!roomId) return;
      if (this.roomId === roomId) void this.leave();
      else void this.join(roomId);
    });

    // Leaving a room leaves its call. The room id is not checked: the room component clears it before telling.
    roomService.LeaveRoom.pipe(skip(1)).subscribe(() => {
      if (this.roomId) void this.leave();
    });

    userlistService.addUserFail.subscribe(update => {
      if (update === UserUpdate.Success) void this.rejoinIfDropped();
    });
  }

  ngOnDestroy(): void {
    this.removeListeners();
    void this.leave();
  }

  get inCall(): boolean {
    return this.roomId !== null;
  }

  get localMediaStream(): MediaStream | null {
    return this.localStream;
  }

  /** Runs one change to the call at a time, so a quick leave and join cannot interleave. */
  private queue(operation: () => Promise<void>): Promise<void> {
    const result = this.busy.then(operation);
    this.busy = result.catch(err => console.error('[VoIP] call change failed', err));
    return result;
  }

  // ================================================================
  // Joining and leaving
  // ================================================================

  public join(roomId: string): Promise<void> {
    return this.queue(async () => {
      if (this.roomId === roomId) return;
      if (this.roomId) await this.leaveNow();
      try {
        await this.joinNow(roomId, false);
      } catch (err) {
        await this.leaveNow(false);
        this.dialogService.PushDefaultDialog(err instanceof Error ? err.message : String(err),
          'Could not join the call', AlertType.Danger);
      }
    });
  }

  public leave(): Promise<void> {
    return this.queue(() => this.leaveNow());
  }

  private async joinNow(roomId: string, muted: boolean): Promise<void> {
    const microphone = await navigator.mediaDevices.getUserMedia({audio: this.microphoneConstraints(), video: false});
    this.localStream = new MediaStream(microphone.getAudioTracks());
    this.roomId = roomId;
    this.callConnectionId = hubConnection.connectionId;

    const roster = await hubConnection.invoke<VoipParticipantDTO[]>('JoinAudioRoom', roomId);
    this.participants.next(roster.map(dto => this.toParticipant(dto)));

    const sfuRoomId = voiceRoomId(roomId);
    const sender = this.sfu.createSender(sfuRoomId);
    const receiver = this.sfu.createReceiver(sfuRoomId);
    this.sender = sender;
    this.receiver = receiver;
    this.linkSubscriptions = [
      receiver.tracks.subscribe(tracks => this.applyReceivedTracks(tracks)),
      sender.state.subscribe(() => this.updateCallState()),
      receiver.state.subscribe(() => this.updateCallState())
    ];

    await sender.open();
    const micTrack = this.localStream.getAudioTracks()[0];
    await sender.produce('audio', voiceAudioOptions(micTrack), muted);
    await receiver.open();

    const settings = loadBrowserSettings();
    this.local.next({
      participantId: hubConnection.connectionId ?? 'local',
      participantName: '',
      stream: null,
      isMuted: muted,
      isVideoMuted: true,
      isScreenMuted: true,
      isSpeaking: false,
      isLocallyMuted: false
    });
    this.startMeter('local', micTrack);
    if (muted) await this.sendStatus();
    this.joinRoom.next(roomId);
    if (settings?.generalSettings.playVoipJoinSound) {
      voipJoinAudio.play().catch(err => console.warn('[VoIP] join sound could not play', err));
    }
  }

  /** Leaves the call. playSound is false when the call never fully started. */
  private async leaveNow(playSound = true): Promise<void> {
    const roomId = this.roomId;
    this.roomId = null;
    this.callConnectionId = null;
    this.videoSource = null;

    this.linkSubscriptions.forEach(subscription => subscription.unsubscribe());
    this.linkSubscriptions = [];
    const sender = this.sender;
    const receiver = this.receiver;
    this.sender = null;
    this.receiver = null;
    await sender?.close();
    await receiver?.close();

    if (roomId && hubConnection.connectionId) {
      await hubConnection.invoke('LeaveAudioRoom', roomId).catch(logHubFailure);
    }

    this.localStream?.getTracks().forEach(track => track.stop());
    this.localStream = null;
    this.audioElements.forEach(element => {
      element.pause();
      element.srcObject = null;
    });
    this.audioElements.clear();
    this.stopAllMeters();
    this.participants.next([]);
    this.local.next(null);
    this.callState.next(null);

    if (roomId) {
      this.leaveRoom.next(roomId);
      if (playSound && loadBrowserSettings()?.generalSettings.playVoipJoinSound) {
        voipLeaveAudio.play().catch(err => console.warn('[VoIP] leave sound could not play', err));
      }
    }
  }

  private microphoneConstraints(): MediaTrackConstraints {
    const microphoneId = loadBrowserSettings()?.webRtcSettings?.microphoneId;
    return {
      deviceId: microphoneId ? {exact: microphoneId} : undefined,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    };
  }

  private updateCallState(): void {
    const states = [this.sender?.state.value, this.receiver?.state.value].filter(Boolean) as SfuLinkState[];
    const order: SfuLinkState[] = ['failed', 'reconnecting', 'connecting', 'connected', 'closed'];
    this.callState.next(states.length ? order.find(state => states.includes(state)) ?? null : null);
    if (states.includes('failed')) {
      this.dialogService.PushDefaultDialog('The connection to the call could not be restored.',
        'Call disconnected', AlertType.Danger);
      void this.leave();
    }
  }

  // ================================================================
  // Microphone, camera and screen
  // ================================================================

  public async setMuted(muted: boolean): Promise<void> {
    const local = this.local.value;
    if (!local || !this.sender) return;
    this.sender.setPaused('audio', muted);
    this.local.next({...local, isMuted: muted});
    await this.sendStatus();
  }

  /** Shows the camera or the screen to the call, or nothing. */
  public async setVideo(source: VideoSource | null): Promise<void> {
    const local = this.local.value;
    const sender = this.sender;
    if (!local || !sender || !this.localStream) return;

    const previous = this.localStream.getVideoTracks()[0] ?? null;
    if (source === null) {
      await sender.remove('video');
    } else {
      const track = source === 'webcam' ? await this.openCamera() : await this.openScreen();
      const codecs = await this.sfu.sendableCodecs();
      const encoding = source === 'webcam' ? CAMERA_ENCODING : SCREEN_ENCODING;
      try {
        await sender.produce('video', videoProducerOptions(track, codecs, encoding));
      } catch (err) {
        track.stop();
        throw err;
      }
      // The browser's stop-sharing bar ends a screen share.
      track.addEventListener('ended', () => {
        if (this.localStream?.getVideoTracks()[0] === track) void this.setVideo(null);
      });
      this.localStream.addTrack(track);
    }
    if (previous) {
      this.localStream.removeTrack(previous);
      previous.stop();
    }

    this.videoSource = source;
    this.local.next({
      ...local,
      stream: source ? new MediaStream(this.localStream.getVideoTracks()) : null,
      isVideoMuted: source !== 'webcam',
      isScreenMuted: source !== 'screen'
    });
    await this.sendStatus();
  }

  private async openCamera(): Promise<MediaStreamTrack> {
    const cameraId = loadBrowserSettings()?.webRtcSettings?.cameraId;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: cameraId ? {exact: cameraId} : undefined,
        width: {ideal: 1280},
        height: {ideal: 720},
        frameRate: {ideal: 30, max: 60}
      }
    });
    return stream.getVideoTracks()[0];
  }

  private async openScreen(): Promise<MediaStreamTrack> {
    const stream = await navigator.mediaDevices.getDisplayMedia({video: {frameRate: {ideal: 30}}, audio: false});
    const track = stream.getVideoTracks()[0];
    track.contentHint = 'detail';
    return track;
  }

  /** Switches to another microphone without leaving the call. */
  public async switchMicrophone(): Promise<void> {
    if (!this.sender || !this.localStream) return;
    const fresh = (await navigator.mediaDevices.getUserMedia({audio: this.microphoneConstraints(), video: false}))
      .getAudioTracks()[0];
    const previous = this.localStream.getAudioTracks()[0];
    await this.sender.replaceTrack('audio', fresh);
    this.localStream.addTrack(fresh);
    if (previous) {
      this.localStream.removeTrack(previous);
      previous.stop();
    }
    this.stopMeter('local');
    this.startMeter('local', fresh);
  }

  /** Switches to another camera, if the camera is what is being shown. */
  public async switchCamera(): Promise<void> {
    if (this.videoSource !== 'webcam' || !this.sender || !this.localStream) return;
    const fresh = await this.openCamera();
    const previous = this.localStream.getVideoTracks()[0];
    await this.sender.replaceTrack('video', fresh);
    this.localStream.addTrack(fresh);
    if (previous) {
      this.localStream.removeTrack(previous);
      previous.stop();
    }
    const local = this.local.value;
    if (local) this.local.next({...local, stream: new MediaStream([fresh])});
  }

  /** Silences or unsilences someone for this listener only. */
  public setParticipantMuted(participantId: string, muted: boolean): void {
    const element = this.audioElements.get(participantId);
    if (element) element.muted = muted;
    this.updateParticipant(participantId, participant => ({...participant, isLocallyMuted: muted}));
  }

  private async sendStatus(): Promise<void> {
    const local = this.local.value;
    if (!local || !this.roomId) return;
    await hubConnection.invoke('SendVoipStatus', this.roomId, local.isMuted, local.isVideoMuted, local.isScreenMuted)
      .catch(logHubFailure);
  }

  // ================================================================
  // Receiving
  // ================================================================

  private toParticipant(dto: VoipParticipantDTO): VoipParticipant {
    return {
      participantId: dto.participantId,
      participantName: dto.participantName ?? '',
      stream: null,
      isMuted: dto.isMuted ?? false,
      isVideoMuted: dto.isVideoMuted ?? true,
      isScreenMuted: dto.isScreenMuted ?? true,
      isSpeaking: false,
      isLocallyMuted: false
    };
  }

  private updateParticipant(participantId: string, change: (participant: VoipParticipant) => VoipParticipant): void {
    this.participants.next(this.participants.value.map(participant =>
      participant.participantId === participantId ? change(participant) : participant));
  }

  /** Gives each participant their received video and plays their received voice. */
  private applyReceivedTracks(tracks: ReceivedTrack[]): void {
    const byPeer = new Map<string, ReceivedTrack[]>();
    tracks.forEach(entry => byPeer.set(entry.peerId, [...(byPeer.get(entry.peerId) ?? []), entry]));

    this.participants.next(this.participants.value.map(participant => {
      const received = byPeer.get(participant.participantId) ?? [];
      const video = received.find(entry => entry.track.kind === 'video')?.track ?? null;
      const audio = received.find(entry => entry.track.kind === 'audio')?.track ?? null;
      this.playVoice(participant, audio);
      const currentVideo = participant.stream?.getVideoTracks()[0] ?? null;
      if (currentVideo === video) return participant;
      return {...participant, stream: video ? new MediaStream([video]) : null};
    }));
  }

  private playVoice(participant: VoipParticipant, track: MediaStreamTrack | null): void {
    const id = participant.participantId;
    const element = this.audioElements.get(id);
    const current = element?.srcObject instanceof MediaStream ? element.srcObject.getAudioTracks()[0] : null;
    if (current === track) return;

    if (element) {
      element.pause();
      element.srcObject = null;
      this.audioElements.delete(id);
      this.stopMeter(id);
    }
    if (!track) return;

    const audio = new Audio();
    audio.autoplay = true;
    audio.muted = participant.isLocallyMuted;
    audio.srcObject = new MediaStream([track]);
    this.audioElements.set(id, audio);
    audio.play().catch(err => {
      // Autoplay needs a gesture when the call was joined automatically; the next click anywhere starts it.
      console.warn('[VoIP] waiting for a click to play the call audio', err);
      document.addEventListener('click', () => {
        audio.play().catch(retryErr => console.error('[VoIP] call audio could not play', retryErr));
      }, {once: true});
    });
    this.startMeter(id, track);
  }

  // ================================================================
  // Who is speaking
  // ================================================================

  /** Measures one voice. One AudioContext and one timer serve every participant. */
  private startMeter(id: string, track: MediaStreamTrack): void {
    this.meterContext ??= new AudioContext();
    const source = this.meterContext.createMediaStreamSource(new MediaStream([track]));
    const analyser = this.meterContext.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    this.meters.set(id, {source, analyser, track});
    this.meterTimer ??= setInterval(() => this.measure(), METER_INTERVAL_MS);
  }

  private stopMeter(id: string): void {
    const meter = this.meters.get(id);
    if (!meter) return;
    meter.source.disconnect();
    this.meters.delete(id);
  }

  private stopAllMeters(): void {
    [...this.meters.keys()].forEach(id => this.stopMeter(id));
    if (this.meterTimer !== null) {
      clearInterval(this.meterTimer);
      this.meterTimer = null;
    }
    const context = this.meterContext;
    this.meterContext = null;
    context?.close().catch(err => console.warn('[VoIP] closing the level meter failed', err));
  }

  private measure(): void {
    const buffer = new Float32Array(512);
    const speaking = new Map<string, boolean>();
    this.meters.forEach(({analyser}, id) => {
      analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (const sample of buffer) sum += sample * sample;
      speaking.set(id, Math.sqrt(sum / buffer.length) > SPEAKING_LEVEL);
    });

    const local = this.local.value;
    if (local && local.isSpeaking !== (!local.isMuted && (speaking.get('local') ?? false))) {
      this.local.next({...local, isSpeaking: !local.isMuted && (speaking.get('local') ?? false)});
    }
    const participants = this.participants.value;
    if (participants.some(participant => participant.isSpeaking !== (speaking.get(participant.participantId) ?? false))) {
      this.participants.next(participants.map(participant =>
        ({...participant, isSpeaking: speaking.get(participant.participantId) ?? false})));
    }
  }

  // ================================================================
  // Signalling and reconnecting
  // ================================================================

  private addListeners(): void {
    hubConnection.on('participantJoined', (dto: VoipParticipantDTO) => {
      if (!this.roomId || this.participants.value.some(participant => participant.participantId === dto.participantId)) return;
      this.participants.next([...this.participants.value, this.toParticipant(dto)]);
      if (loadBrowserSettings()?.generalSettings.playVoipJoinSound) {
        voipJoinAudio.play().catch(err => console.warn('[VoIP] join sound could not play', err));
      }
    });

    hubConnection.on('participantLeft', (dto: VoipParticipantDTO) => {
      const leaving = this.participants.value.find(participant => participant.participantId === dto.participantId);
      if (!leaving) return;
      this.playVoice(leaving, null);
      this.participants.next(this.participants.value.filter(participant => participant !== leaving));
      if (loadBrowserSettings()?.generalSettings.playVoipJoinSound) {
        voipLeaveAudio.play().catch(err => console.warn('[VoIP] leave sound could not play', err));
      }
    });

    hubConnection.on('receiveStatusFromParticipant', (dto: VoipParticipantDTO) => {
      this.updateParticipant(dto.participantId, participant => ({
        ...participant,
        isMuted: dto.isMuted ?? participant.isMuted,
        isVideoMuted: dto.isVideoMuted ?? participant.isVideoMuted,
        isScreenMuted: dto.isScreenMuted ?? participant.isScreenMuted
      }));
    });
  }

  private removeListeners(): void {
    hubConnection.off('participantJoined');
    hubConnection.off('participantLeft');
    hubConnection.off('receiveStatusFromParticipant');
  }

  /**
   * After a reconnect that brought a new connection, the server has already taken this client out of the call. The
   * call is left here too and joined again, with the same mute state, once the room has been rejoined.
   */
  private noticeReplacedConnection(): void {
    if (!this.roomId || !this.callConnectionId || hubConnection.connectionId === this.callConnectionId) return;
    this.rejoinAfterReconnect = {roomId: this.roomId, muted: this.local.value?.isMuted ?? false};
    void this.queue(() => this.leaveNow(false));
  }

  private async rejoinIfDropped(): Promise<void> {
    const rejoin = this.rejoinAfterReconnect;
    this.rejoinAfterReconnect = null;
    if (!rejoin) return;
    await this.queue(async () => {
      if (this.roomId) return;
      try {
        await this.joinNow(rejoin.roomId, rejoin.muted);
      } catch (err) {
        await this.leaveNow(false);
        this.dialogService.PushDefaultDialog(err instanceof Error ? err.message : String(err),
          'Could not rejoin the call', AlertType.Danger);
      }
    });
  }
}
