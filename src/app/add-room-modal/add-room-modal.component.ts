import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { randomID } from '../helper/generic';
import { Room } from '../Interfaces/Room';
import { Server } from '../Interfaces/server';
import { User } from '../Interfaces/User';
import { SignalRService } from '../services/signal-r.service';
import * as sha512 from 'js-sha512';
declare var $:any

@Component({
  selector: 'app-add-room-modal',
  templateUrl: './add-room-modal.component.html',
  styleUrls: ['./add-room-modal.component.scss']
})
export class AddRoomModalComponent implements OnInit {

  constructor(public signalRService: SignalRService) { }
  @Output() JoinRoom = new EventEmitter();
  @Input() user: User;
  @Input() logout: boolean;
  NewRoomName: string = "";
  NewRoomPassword: string = "";

  ngOnInit(): void {
  }

  alphaKeys(event: KeyboardEvent) {
    var key = event.key;
    if (key == "Enter" && this.NewRoomName.length>0) {
      this.CreateRoom(this.NewRoomName, this.NewRoomPassword);
    }
    if (this.NewRoomName.length>20) {
      return false;
    }
    if (key.match("[-a-zA-Z0-9_ ]")) {
      return;
    }
    return false;
  }

  public async CreateRoom(roomName: string, pw: string) {
    const pwSha: string = pw && pw.length > 0 ? sha512.sha512(pw) : null;
    if (roomName != null && roomName.length > 0) {
      var randomId = randomID();
      var server: Server = { currenttime: 0, isplaying: false, members: [], title: "Nothing playing", currentVideo: {title: "", url: ""}, playlist: [], gallowWord: "", playingGallows: false }
      var room: Room = { uniqueId: randomId, name: roomName, server: server, password: pwSha, deletable: true }
      this.signalRService.addRoom(room);
      this.JoinRoom.emit(randomId);
      this.NewRoomName = "";
      $("#addRoomModal").modal('hide');
    }
  }

}
