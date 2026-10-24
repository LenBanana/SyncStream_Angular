import {
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output
} from '@angular/core';
import {CapturedMedia, Resolution, StreamAudience, StreamContentPreference} from '../webrtc-service/webrtc.service';
import {BrowserSettings, changeSettings} from '../../../Interfaces/BrowserSettings';

export {StreamAudience} from '../webrtc-service/webrtc.service';

/**
 * What the dialog hands over when the user confirms. The capture now belongs to the receiver, which releases it
 * once the stream ends; the dialog keeps nothing running of its own.
 */
export interface StreamStartConfig {
  capture: CapturedMedia;
  audience: StreamAudience;
}

/** Quality preset definition. */
export interface QualityPreset {
  label: string;
  description: string;
  icon: string;
  resolution: Resolution;
  frameRate: number;
  maxBitrate: number; // bps
}

export const QUALITY_PRESETS: QualityPreset[] = [
  {
    label: 'Low',
    description: '720p · 30 fps · 1.5 Mbps — great for slow connections',
    icon: 'fa-signal',
    resolution: Resolution.HD,
    frameRate: 30,
    maxBitrate: 1_500_000
  },
  {
    label: 'Balanced',
    description: '1080p · 30 fps · 3 Mbps — recommended default',
    icon: 'fa-signal',
    resolution: Resolution.FHD,
    frameRate: 30,
    maxBitrate: 3_000_000
  },
  {
    label: 'High',
    description: '1080p · 60 fps · 10 Mbps — smooth motion',
    icon: 'fa-signal',
    resolution: Resolution.FHD,
    frameRate: 60,
    maxBitrate: 10_000_000
  },
  {
    label: 'Ultra',
    description: '1440p · 60 fps · 18 Mbps — best quality',
    icon: 'fa-signal',
    resolution: Resolution.QHD,
    frameRate: 60,
    maxBitrate: 18_000_000
  },
  {
    label: 'Custom',
    description: 'Set your own resolution, frame rate and bitrate',
    icon: 'fa-sliders',
    resolution: Resolution.FHD,
    frameRate: 60,
    maxBitrate: 10_000_000
  }
];

export type DialogStep = 'source' | 'quality' | 'audio';

@Component({
  selector: 'app-stream-start-dialog',
  templateUrl: './stream-start-dialog.component.html',
  styleUrls: ['./stream-start-dialog.component.scss']
})
export class StreamStartDialogComponent implements OnInit, OnDestroy {

  @Input() browserSettings: BrowserSettings;
  @Input() audienceMode: 'mixed' | 'personal' | 'room' = 'mixed';
  /** Emitted when the user confirms — caller should start streaming with the result. */
  @Output() confirmed = new EventEmitter<StreamStartConfig>();
  /** Emitted when the user cancels. */
  @Output() cancelled = new EventEmitter<void>();

  // ---- Dialog state ----
  step: DialogStep = 'source';
  isLoading = false;
  errorMessage = '';
  selectedAudience: StreamAudience = 'personal';

  // ---- Source step ----
  /** Choices filled from getDisplayMedia enumeration where supported, plus camera */
  sourceOptions: SourceOption[] = [];
  selectedSourceId: string | null = null;
  private previewStreams: Map<string, MediaStream> = new Map();
  private enumerationSupported = false;

  // ---- Active live preview for the selected source ----
  previewStream: MediaStream | null = null;

  // ---- Quality step ----
  readonly presets = QUALITY_PRESETS;
  readonly Resolution = Resolution;
  selectedPresetIndex = 1; // Default: Balanced
  customResolution: Resolution = Resolution.FHD;
  customFrameRate = 60;
  customBitrateKbps = 10000;
  contentPreference: StreamContentPreference = 'motion';
  readonly resolutionOptions = [
    {label: '720p (HD)', value: Resolution.HD},
    {label: '1080p (Full HD)', value: Resolution.FHD},
    {label: '1440p (QHD)', value: Resolution.QHD},
    {label: '2160p (4K)', value: Resolution.UHD}
  ];

  // ---- Audio step ----
  shareSystemAudio = false;
  shareMicrophone = false;
  microphoneId: string | null = null;
  microphoneVolume = 100;
  systemAudioVolume = 100;
  audioInputDevices: MediaDeviceInfo[] = [];
  /** True when the user asked for system audio but the browser/source didn't deliver it. */
  systemAudioMissing = false;

  // ---- Captured source, until it is handed over ----
  private capturedStream: MediaStream | null = null;

  constructor() {}

  ngOnInit(): void {
    this._initFromSettings();
    this._startSourceEnumeration();
  }

  ngOnDestroy(): void {
    // Whatever was confirmed has been handed over already; this only releases a capture that never was.
    this._releaseAllPreviews();
    if (this.capturedStream) {
      this.capturedStream.getTracks().forEach(t => t.stop());
      this.capturedStream = null;
    }
  }

  // ===========================================================================
  // Lifecycle helpers
  // ===========================================================================

  private _initFromSettings(): void {
    this.selectedAudience = this.resolvedAudience;
    if (!this.browserSettings) return;
    const s = this.browserSettings.webRtcSettings;
    this.shareMicrophone = s.shareMicrophone ?? false;
    this.shareSystemAudio = s.shareSystemAudio ?? false;
    this.microphoneId = s.microphoneId ?? null;
    this.microphoneVolume = s.microphoneVolume ?? 100;
    this.systemAudioVolume = s.systemAudioVolume ?? 100;
    this.customResolution = s.idealResolution ?? Resolution.FHD;
    this.customFrameRate = s.idealFrameRate ?? 60;
    this.customBitrateKbps = Math.round((s.maxVideoBitrate ?? 3_000_000) / 1000);
    this.contentPreference = s.streamContentPreference ?? 'motion';
    // Pick closest preset or fall back to Custom
    const matchIdx = QUALITY_PRESETS.slice(0, -1).findIndex(
      p => p.resolution === this.customResolution &&
           p.frameRate === this.customFrameRate
    );
    this.selectedPresetIndex = matchIdx >= 0 ? matchIdx : QUALITY_PRESETS.length - 1;
  }

  private async _startSourceEnumeration(): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';

    // Always offer "Entire Screen / Window" as a generic catch-all
    this.sourceOptions = [
      {
        id: '__display__',
        label: 'Screen / Window / Tab',
        icon: 'fa-desktop',
        type: 'display',
        thumbnailStream: null
      }
    ];

    // Cameras are listed without asking for them. Asking used to open the camera (and the permission prompt) every
    // time the dialog opened, even to share a screen; the prompt now only appears once a camera is picked.
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter(d => d.kind === 'videoinput');
    cameras.forEach((cam, index) => {
      this.sourceOptions.push({
        // Without permission the browser hides device ids; the camera is then chosen by the system default.
        id: cam.deviceId || `__camera_${index}__`,
        label: cam.label || `Camera ${index + 1}`,
        icon: 'fa-camera',
        type: 'camera',
        thumbnailStream: null
      });
    });
    this.audioInputDevices = devices.filter(d => d.kind === 'audioinput');

    // Auto-select first option
    this.selectedSourceId = this.sourceOptions[0]?.id ?? null;
    this.isLoading = false;

    // Live thumbnails only where the camera may already be used without asking.
    const camerasAllowed = cameras.some(cam => cam.label !== '');
    if (camerasAllowed) await this._refreshThumbnailPreviews();
  }

  private async _refreshThumbnailPreviews(): Promise<void> {
    for (const opt of this.sourceOptions) {
      if (opt.type !== 'camera') continue;
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: {deviceId: {exact: opt.id}, width: {ideal: 320}, height: {ideal: 180}},
          audio: false
        });
        this.previewStreams.set(opt.id, s);
        opt.thumbnailStream = s;
      } catch (err) {
        // A camera in use by another application cannot be previewed; it is still offered.
        console.warn(`Camera preview unavailable for ${opt.label}:`, err);
      }
    }
  }

  private _releaseAllPreviews(): void {
    this.previewStreams.forEach(s => s.getTracks().forEach(t => t.stop()));
    this.previewStreams.clear();
    if (this.previewStream) {
      this.previewStream.getTracks().forEach(t => t.stop());
      this.previewStream = null;
    }
  }

  // ===========================================================================
  // Step navigation
  // ===========================================================================

  get canProceed(): boolean {
    if (this.step === 'source') return !!this.selectedSourceId;
    if (this.step === 'quality') return true;
    return true;
  }

  get showAudienceChoice(): boolean {
    return this.audienceMode === 'mixed';
  }

  get resolvedAudience(): StreamAudience {
    if (this.audienceMode === 'room') return 'room';
    if (this.audienceMode === 'personal') return 'personal';
    return this.selectedAudience;
  }

  get resolvedAudienceLabel(): string {
    return this.resolvedAudience === 'room' ? 'Room stage' : 'Member list';
  }

  get audienceSummaryText(): string {
    return this.resolvedAudience === 'room'
      ? 'Switches the room player for everyone immediately.'
      : 'Shows you as live in the member list so people can join manually.';
  }

  async next(): Promise<void> {
    if (this.step === 'source') {
      await this._captureSource();
      if (!this.capturedStream) return;
      this.step = 'quality';
    } else if (this.step === 'quality') {
      this.step = 'audio';
    } else {
      await this._confirm();
    }
  }

  back(): void {
    if (this.step === 'quality') {
      // Release captured source so user can reselect
      this.capturedStream?.getTracks().forEach(t => t.stop());
      this.capturedStream = null;
      this.step = 'source';
    } else if (this.step === 'audio') {
      this.step = 'quality';
    }
  }

  cancel(): void {
    this._releaseAllPreviews();
    this.capturedStream?.getTracks().forEach(t => t.stop());
    this.capturedStream = null;
    this.cancelled.emit();
  }

  // ===========================================================================
  // Source capture
  // ===========================================================================

  selectSource(id: string): void {
    this.selectedSourceId = id;
  }

  selectAudience(audience: StreamAudience): void {
    this.selectedAudience = audience;
  }

  private async _captureSource(): Promise<void> {
    const option = this.sourceOptions.find(o => o.id === this.selectedSourceId);
    if (!option) return;

    this.isLoading = true;
    this.errorMessage = '';

    try {
      if (option.type === 'display') {
        // Capture the source at its native resolution: the user has not selected a
        // quality preset yet (that is step 2). The encoder scales to the preset when
        // sending; over-constraining the capture here only causes the browser to reject
        // or ignore the constraints.
        //
        // systemAudio / surfaceSwitching / selfBrowserSurface are Chromium hints that
        // make the native picker default the "Share tab audio" checkbox to checked and
        // show all surface types.  Non-Chromium browsers silently ignore them.
        this.capturedStream = await (navigator.mediaDevices.getDisplayMedia as Function)({
          video: {frameRate: {ideal: 60}} as MediaTrackConstraints,
          audio: this.shareSystemAudio
            ? {echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: 48000}
            : false,
          systemAudio:        this.shareSystemAudio ? 'include' : 'exclude',
          surfaceSwitching:   'include',
          selfBrowserSurface: 'exclude',
          monitorTypeSurfaces: 'include',
        });

        // Detect if audio was requested but not delivered (Linux, Firefox, Window/Screen mode).
        this.systemAudioMissing =
          this.shareSystemAudio && this.capturedStream.getAudioTracks().length === 0;
      } else {
        // Camera: capture at native resolution; frameRate is tightened on confirm.
        this.capturedStream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: option.id.startsWith('__camera_') ? undefined : {exact: option.id},
            width: {ideal: 1920},
            height: {ideal: 1080},
            frameRate: {ideal: 60}
          },
          audio: false
        });
      }

      // Update preview in the dialog
      this.previewStream = this.capturedStream;

      // If the user stops via the browser's native stop button, reset state
      this.capturedStream.getVideoTracks()[0]?.addEventListener('ended', () => {
        this.cancel();
      });
    } catch (err: any) {
      this.errorMessage = err?.name === 'NotAllowedError'
        ? 'Permission denied. Please allow screen sharing in your browser.'
        : `Could not capture source: ${err?.message ?? 'Unknown error'}`;
    }

    this.isLoading = false;
  }

  // ===========================================================================
  // Quality
  // ===========================================================================

  selectPreset(index: number): void {
    this.selectedPresetIndex = index;
    const p = this.presets[index];
    if (index < this.presets.length - 1) {
      // Sync custom fields so switching to Custom starts with current preset values
      this.customResolution = p.resolution;
      this.customFrameRate = p.frameRate;
      this.customBitrateKbps = Math.round(p.maxBitrate / 1000);
    }
  }

  selectContentPreference(preference: StreamContentPreference): void {
    this.contentPreference = preference;
  }

  get contentPreferenceLabel(): string {
    return this.contentPreference === 'detail' ? 'Detail' : 'Motion';
  }

  get isCustomPreset(): boolean {
    return this.selectedPresetIndex === this.presets.length - 1;
  }

  get bitrateLabel(): string {
    const kbps = this.isCustomPreset ? this.customBitrateKbps : Math.round(this._activePreset().maxBitrate / 1000);
    return kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbps` : `${kbps} Kbps`;
  }

  private _activePreset(): QualityPreset {
    if (this.isCustomPreset) {
      return {
        ...this.presets[this.presets.length - 1],
        resolution: this.customResolution,
        frameRate: this.customFrameRate,
        maxBitrate: this.customBitrateKbps * 1000
      };
    }
    return this.presets[this.selectedPresetIndex];
  }

  private _buildVideoConstraints(preset: QualityPreset, sourceType: SourceOption['type']): MediaTrackConstraints {
    if (sourceType === 'display') {
      return {
        frameRate: {ideal: preset.frameRate, max: preset.frameRate}
      };
    }

    const height = preset.resolution;
    const width = Math.round((height * 16) / 9);
    return {
      width: {ideal: width, max: width},
      height: {ideal: height, max: height},
      frameRate: {ideal: preset.frameRate, max: preset.frameRate}
    };
  }

  // ===========================================================================
  // Confirm
  // ===========================================================================

  private async _confirm(): Promise<void> {
    if (!this.capturedStream) return;

    this.isLoading = true;
    this.errorMessage = '';

    try {
      const source = this.capturedStream;
      const videoTrack = source.getVideoTracks()[0];
      const systemAudioTracks = source.getAudioTracks();
      let micTrack: MediaStreamTrack | null = null;

      if (this.shareMicrophone) {
        try {
          const micStream = await navigator.mediaDevices.getUserMedia({
            audio: this.microphoneId ? {deviceId: {exact: this.microphoneId}} : true,
            video: false
          });
          micTrack = micStream.getAudioTracks()[0] ?? null;
        } catch (err) {
          console.warn('Could not capture microphone:', err);
        }
      }

      // Every track captured here, sent or not, so all of them can be released together.
      const capturedTracks = [...source.getTracks(), ...(micTrack ? [micTrack] : [])];
      const {audioTrack, mixer} = this._prepareAudio(systemAudioTracks, micTrack);
      const finalStream = new MediaStream([videoTrack, audioTrack].filter((track): track is MediaStreamTrack => !!track));

      // Persist settings to BrowserSettings
      if (this.browserSettings) {
        const preset = this._activePreset();
        const s = this.browserSettings.webRtcSettings;
        s.idealResolution = preset.resolution;
        s.idealFrameRate = preset.frameRate;
        s.maxVideoBitrate = preset.maxBitrate;
        s.streamContentPreference = this.contentPreference;
        s.shareMicrophone = this.shareMicrophone;
        s.shareSystemAudio = this.shareSystemAudio;
        s.microphoneId = this.microphoneId;
        s.microphoneVolume = this.microphoneVolume;
        s.systemAudioVolume = this.systemAudioVolume;
        changeSettings(this.browserSettings);
      }

      const preset = this._activePreset();
      const sourceType = this.sourceOptions.find(o => o.id === this.selectedSourceId)?.type ?? 'display';

      // Enforce the user's chosen resolution/frameRate on the captured track now
      // that the preset is known. applyConstraints is safe on a live track; some
      // browsers may ignore parts of it for display capture, so this is best-effort.
      if (videoTrack) {
        // contentHint steers the encoder: 'detail' keeps screen text sharp, 'motion' keeps the frame rate.
        videoTrack.contentHint = sourceType === 'display' ? this.contentPreference : 'motion';
        await videoTrack
          .applyConstraints(this._buildVideoConstraints(preset, sourceType))
          .catch(e => console.warn('applyConstraints (video quality) failed:', e));
      }

      // Handed over: from here the receiver owns these tracks and the mixer, so ngOnDestroy must not touch them.
      this.capturedStream = null;
      this.previewStream = null;

      this.confirmed.emit({
        capture: {
          stream: finalStream,
          encoding: {
            maxBitrate: preset.maxBitrate,
            maxHeight: preset.resolution,
            frameRate: preset.frameRate,
            contentPreference: this.contentPreference
          },
          release: () => {
            capturedTracks.forEach(track => track.stop());
            mixer?.close().catch(err => console.warn('Closing the audio mixer failed:', err));
          }
        },
        audience: this.resolvedAudience
      });
    } catch (err) {
      this.errorMessage = `Failed to start stream: ${err instanceof Error ? err.message : String(err)}`;
    }

    this.isLoading = false;
  }

  /**
   * The audio to send: the one source as it is when that is all there is at full volume, or a mix of the sources
   * with their volumes. A mix runs in an AudioContext that has to stay open for as long as the stream is sent;
   * closing it silences the mixed track without ending it, which is how a stream used to go silent the moment this
   * dialog closed.
   */
  private _prepareAudio(systemAudioTracks: MediaStreamTrack[], micTrack: MediaStreamTrack | null):
    {audioTrack: MediaStreamTrack | null; mixer: AudioContext | null} {
    const systemTrack = systemAudioTracks[0] ?? null;
    if (!systemTrack && !micTrack) return {audioTrack: null, mixer: null};
    if (systemTrack && !micTrack && this.systemAudioVolume === 100) return {audioTrack: systemTrack, mixer: null};
    if (micTrack && !systemTrack && this.microphoneVolume === 100) return {audioTrack: micTrack, mixer: null};

    const mixer = new AudioContext({sampleRate: 48000});
    const dest = mixer.createMediaStreamDestination();
    const addSource = (track: MediaStreamTrack, volumePercent: number) => {
      const src = mixer.createMediaStreamSource(new MediaStream([track]));
      const gain = mixer.createGain();
      gain.gain.value = Math.max(0, Math.min(2, volumePercent / 100));
      src.connect(gain);
      gain.connect(dest);
    };
    if (systemTrack) addSource(systemTrack, this.systemAudioVolume);
    if (micTrack) addSource(micTrack, this.microphoneVolume);
    return {audioTrack: dest.stream.getAudioTracks()[0] ?? null, mixer};
  }

  // ===========================================================================
  // Audio helpers
  // ===========================================================================

  get selectedMicLabel(): string {
    const mic = this.audioInputDevices.find(d => d.deviceId === this.microphoneId);
    return mic?.label || 'Default microphone';
  }

  onMicChange(deviceId: string): void {
    this.microphoneId = deviceId || null;
  }

  // ===========================================================================
  // Utility
  // ===========================================================================

  readonly steps: DialogStep[] = ['source', 'quality', 'audio'];

  get stepIndex(): number {
    return this.steps.indexOf(this.step);
  }

  get stepLabel(): string {
    const labels: Record<DialogStep, string> = {
      source: 'Choose Source',
      quality: 'Quality',
      audio: 'Audio'
    };
    return labels[this.step];
  }
}

export interface SourceOption {
  id: string;
  label: string;
  icon: string;
  type: 'display' | 'camera';
  thumbnailStream: MediaStream | null;
}
