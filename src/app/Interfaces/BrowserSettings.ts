import {BehaviorSubject} from "rxjs";
import {Resolution} from "../media/webrtc/webrtc-service/webrtc.service";

export var browserSettingName = "userSettings";
export var settingsUpdate: BehaviorSubject<boolean> = new BehaviorSubject(null);

export class LayoutSettings {
  showCountInfo: boolean;
  bigSideNav: boolean;
  menuSize: number;

  constructor() {
    this.showCountInfo = true;
    this.bigSideNav = false;
    this.menuSize = 90;
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
  maxVideoBitrate: number;
  idealResolution: Resolution;
  idealFrameRate: number;
  microphoneId: string;
  cameraId: string;
  microphoneVolume: number;

  constructor() {
    this.shareScreen = true;
    this.shareMicrophone = false;
    this.maxVideoBitrate = 300000;
    this.idealResolution = Resolution.FHD;
    this.idealFrameRate = 60;
    this.playerWidth = window.screen.width;
    this.microphoneId = null;
    this.cameraId = null;
    this.microphoneVolume = 100;
  }
}


export class BrowserSettings {
  layoutSettings: LayoutSettings;
  generalSettings: GeneralSettings;
  webRtcSettings: WebRtcSettings;

  constructor() {
    this.layoutSettings = new LayoutSettings();
    this.generalSettings = new GeneralSettings();
    this.webRtcSettings = new WebRtcSettings();
  }
}


export function IsYt(url: string) {
  return (url.includes('youtube') && (url.includes("?v=") || url.includes("/playlist?list="))) || url.includes('youtu.be');
}

export function IsTwitch(url: string) {
  return url.includes('twitch.tv');
}

export function changeSettings(browserSettings) {
  const settingsJson = JSON.stringify(browserSettings);
  localStorage.setItem(browserSettingName, settingsJson);
  settingsUpdate.next(true);
}
