import {dealCardSound, voipJoinSound, voipLeaveSound} from "../global.settings";

export enum BlackjackSounds {
  DealCard = 0
}

export var dealCardAudio = new Audio(dealCardSound);
export var voipJoinAudio = new Audio(voipJoinSound);
export var voipLeaveAudio = new Audio(voipLeaveSound);

export function setVolume(volume: number) {
  dealCardAudio.volume = volume;
  voipJoinAudio.volume = volume;
  voipLeaveAudio.volume = volume;
}
