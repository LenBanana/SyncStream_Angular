import { User } from "./User";

export class LiveUser {
  userName: string;
  watchMember: User[];
  created: Date;

}

export function timeDifference(date) {
  var ms = new Date().getTime() - new Date(date).getTime() + 10000;
  let seconds = Math.round(ms / 1000);
  const hours = Math.round(seconds / 3600);
  seconds = Math.round(seconds % 3600);
  const minutes = Math.round(seconds / 60);
  seconds = Math.round(seconds % 60);
  return ('0' + hours).slice(-2)+":"+('0' + minutes).slice(-2)+":"+('0' + seconds).slice(-2);
}
