import { BehaviorSubject } from "rxjs";

export var browserSettingName = "userSettings";
export var settingsUpdate: BehaviorSubject<boolean> = new BehaviorSubject(null);

export class LayoutSettings {
  showCountInfo: boolean;
  bigSideNav: boolean;
  constructor() {
    this.showCountInfo = true;
    this.bigSideNav = false;
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

export function changeSettings(browserSettings) {
  var settingsJson = JSON.stringify(browserSettings);
  localStorage.setItem(browserSettingName, settingsJson);
  settingsUpdate.next(true);
}
