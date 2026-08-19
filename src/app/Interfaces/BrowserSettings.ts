import {BehaviorSubject} from "rxjs";
import {Resolution, StreamContentPreference} from "../media/webrtc/webrtc-service/webrtc.service";
import {Point} from "@angular/cdk/drag-drop";
import {createDefaultSponsorBlockCategoryMap, sponsorBlockCategoryOrder, SponsorBlockCategorySettingsMap} from "./SponsorBlock";

export var browserSettingName = "userSettings";
export var settingsUpdate: BehaviorSubject<boolean> = new BehaviorSubject(null);

export class LayoutSettings {
  showCountInfo: boolean;
  bigSideNav: boolean;
  menuSize: number;
  menuPosition: Point;

  constructor() {
    this.showCountInfo = true;
    this.bigSideNav = false;
    this.menuSize = 90;
    this.menuPosition = {x: 0, y: 0};
  }
}

export class GeneralSettings {
  firstVisit: boolean = true;
  audioVolume: number = 100;
  defaultVoip: boolean = false;
  playVoipJoinSound: boolean = true;
}

export class WebRtcSettings {
  playerWidth: number;
  shareScreen: boolean;
  shareMicrophone: boolean;
  shareSystemAudio: boolean;
  maxVideoBitrate: number;
  idealResolution: Resolution;
  idealFrameRate: number;
  streamContentPreference: StreamContentPreference;
  microphoneId: string;
  cameraId: string;
  microphoneVolume: number;
  systemAudioVolume: number;

  constructor() {
    this.shareScreen = true;
    this.shareMicrophone = false;
    this.shareSystemAudio = false;
    this.maxVideoBitrate = 300000;
    this.idealResolution = Resolution.FHD;
    this.idealFrameRate = 60;
    this.streamContentPreference = 'motion';
    this.playerWidth = window.screen.width;
    this.microphoneId = null;
    this.cameraId = null;
    this.microphoneVolume = 100;
    this.systemAudioVolume = 100;
  }
}

export class SponsorBlockSettings {
  enabled: boolean;
  showMarkers: boolean;
  showSkipNotice: boolean;
  categories: SponsorBlockCategorySettingsMap;

  constructor() {
    this.enabled = true;
    this.showMarkers = true;
    this.showSkipNotice = true;
    this.categories = createDefaultSponsorBlockCategoryMap();
  }
}

export class PlaybackSettings {
  sponsorBlock: SponsorBlockSettings;

  constructor() {
    this.sponsorBlock = new SponsorBlockSettings();
  }
}

export class BrowserSettings {
  layoutSettings: LayoutSettings;
  generalSettings: GeneralSettings;
  webRtcSettings: WebRtcSettings;
  playbackSettings: PlaybackSettings;

  constructor() {
    this.layoutSettings = new LayoutSettings();
    this.generalSettings = new GeneralSettings();
    this.webRtcSettings = new WebRtcSettings();
    this.playbackSettings = new PlaybackSettings();
  }
}

export function IsYt(url: string) {
  return (url.includes('youtube') && (url.includes("?v=") || url.includes("/playlist?list="))) || url.includes('youtu.be');
}

export function IsTwitch(url: string) {
  return url.includes('twitch.tv');
}

function normalizeSponsorBlockSettings(settings?: Partial<SponsorBlockSettings>): SponsorBlockSettings {
  const normalized = new SponsorBlockSettings();
  if (!settings) {
    return normalized;
  }
  normalized.enabled = settings.enabled ?? normalized.enabled;
  normalized.showMarkers = settings.showMarkers ?? normalized.showMarkers;
  normalized.showSkipNotice = settings.showSkipNotice ?? normalized.showSkipNotice;
  normalized.categories = {
    ...createDefaultSponsorBlockCategoryMap(),
    ...(settings.categories ?? {})
  };
  if (settings.categories && sponsorBlockCategoryOrder.every(category => settings.categories[category] === true)) {
    normalized.categories.filler = false;
  }
  return normalized;
}

function normalizePlaybackSettings(settings?: Partial<PlaybackSettings>): PlaybackSettings {
  const normalized = new PlaybackSettings();
  if (!settings) {
    return normalized;
  }
  normalized.sponsorBlock = normalizeSponsorBlockSettings(settings.sponsorBlock);
  return normalized;
}

export function normalizeBrowserSettings(settings?: Partial<BrowserSettings>): BrowserSettings {
  const normalized = new BrowserSettings();
  if (!settings) {
    return normalized;
  }
  normalized.layoutSettings = {
    ...normalized.layoutSettings,
    ...(settings.layoutSettings ?? {})
  };
  normalized.generalSettings = {
    ...normalized.generalSettings,
    ...(settings.generalSettings ?? {})
  };
  normalized.webRtcSettings = {
    ...normalized.webRtcSettings,
    ...(settings.webRtcSettings ?? {})
  };
  normalized.playbackSettings = normalizePlaybackSettings(settings.playbackSettings);
  return normalized;
}

export function loadBrowserSettings(): BrowserSettings {
  try {
    const raw = localStorage.getItem(browserSettingName);
    return raw ? normalizeBrowserSettings(JSON.parse(raw) as BrowserSettings) : new BrowserSettings();
  } catch {
    return new BrowserSettings();
  }
}

export function changeSettings(browserSettings) {
  const settingsJson = JSON.stringify(normalizeBrowserSettings(browserSettings));
  localStorage.setItem(browserSettingName, settingsJson);
  settingsUpdate.next(true);
}
