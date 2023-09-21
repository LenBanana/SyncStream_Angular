import { BehaviorSubject } from "rxjs";

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
}

export class BrowserSettings {
  layoutSettings: LayoutSettings;
  generalSettings: GeneralSettings;
  constructor() {
    this.layoutSettings = new LayoutSettings();
    this.generalSettings = new GeneralSettings();
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
