import { Component, OnInit, Input, ViewChild, Output, EventEmitter } from '@angular/core';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { PlaylistService } from '../playlist/playlist-service/playlist.service';
import { UserlistService } from '../userlist/userlist-service/userlist.service';
import { VideoDTO } from '../Interfaces/VideoDTO';
import { Member } from '../Interfaces/Member';
import { PlayerComponent } from '../player/player.component';
import { Location } from '@angular/common';

@Component({
  selector: 'app-side-nav',
  templateUrl: './side-nav.component.html',
  styleUrls: ['./side-nav.component.scss']
})
export class SideNavComponent implements OnInit {

  constructor(public playlistService: PlaylistService, public userService: UserlistService, private location: Location) { }

  @Input() logout: boolean;
  @Input() nav: boolean;
  @Input() fullscreen: boolean;
  @Input() IsHost: boolean;
  @Input() isPlaying: boolean;
  @Input() UniqueId: string;
  @Input() Username: string;
  @Input() Members: Member[];
  @Input() Playlist: VideoDTO[] = [];
  @Input() playerComp: PlayerComponent;
  @Input() ThreshholdNumber: number = 0.5;
  @Output() threshholdChange = new EventEmitter();
  @Output() usernameChange = new EventEmitter();
  @Output() toggleTwitch = new EventEmitter();
  @Output() menuEnter = new EventEmitter();
  @Output() menuExit = new EventEmitter();
  @Output() Draw = new EventEmitter();
  Threshhold = false;
  showInput = false;
  showPlaylist = false;
  showUsername = false;

  ngOnInit(): void {
    if (this.IsHost) {      
      this.ThreshholdNumber = 2;
      this.threshholdChange.emit(this.ThreshholdNumber);
    } else {      
      this.ThreshholdNumber = .5;
      this.threshholdChange.emit(this.ThreshholdNumber);
    }
  } 
  
  refresh(): void {
    this.location.go("/");
    window.location.reload();
  }

  enterMenu() {
    this.menuEnter.emit();
  }

  exitMenu() {
    this.menuExit.emit();
  }

  SetHost() {    
    this.userService.changeHost(this.Username, this.UniqueId);    
  }

  SetThreshhold() {
    var threshholdinput = document.getElementById('threshhold-input') as HTMLInputElement;
    if (!threshholdinput || threshholdinput.value.length === 0) {
      return;
    }
    this.ThreshholdNumber = Number(threshholdinput.value);
    this.threshholdChange.emit(this.ThreshholdNumber);
  }

  SetUsername() {
    var usernameinput = document.getElementById('username-input') as HTMLInputElement;
    if (!usernameinput || usernameinput.value.length === 0) {
      return;
    }
    this.Username = usernameinput.value;
    this.usernameChange.emit(this.Username);
  }

  ToggleInput() {
    if (this.showPlaylist) {
      this.TogglePlaylist();
    }
    if (this.Threshhold) {
      this.ToggleThreshhold();
    }
    if (this.showUsername) {
      this.ToggleUsername();
    }
    if (this.showInput) {
      this.showInput = false;
    } else {
      this.showInput = true;
    }
  }

  TogglePlaylist() {
    if (this.showInput) {
      this.ToggleInput();
    }
    if (this.Threshhold) {
      this.ToggleThreshhold();
    }
    if (this.showUsername) {
      this.ToggleUsername();
    }
    if (this.showPlaylist) {
      this.showPlaylist = false;
    } else {
      this.showPlaylist = true;
    }
  }   

  ToggleThreshhold() {
    if (this.showPlaylist) {
      this.TogglePlaylist();
    }
    if (this.showInput) {
      this.ToggleInput();
    }
    if (this.showUsername) {
      this.ToggleUsername();
    }
    if (this.Threshhold) {
      this.Threshhold = false;
    } else {
      this.Threshhold = true;
    }
  }   

  ToggleUsername() {
    if (this.showPlaylist) {
      this.TogglePlaylist();
    }
    if (this.showInput) {
      this.ToggleInput();
    }
    if (this.Threshhold) {
      this.ToggleThreshhold();
    }
    if (this.showUsername) {
      this.showUsername = false;
    } else {
      this.showUsername = true;
    }
  }  
  
  toggleTwitchChat() {
    this.toggleTwitch.emit()
  }

  DrawWhiteboard() {
    this.Draw.emit();
  }

  play(url: string) {
    this.playlistService.playVideo(url, this.UniqueId);
  }

  delete(key: string) {
    this.playlistService.removeVideo(key, this.UniqueId);
  }

  nextVideo() {
    this.playlistService.nextVideo(this.UniqueId);
  }

  drop(event: CdkDragDrop<string[]>) {
    if (event.previousIndex == event.currentIndex || event.currentIndex == 0) {
      return;
    }
    moveItemInArray(this.Playlist, event.previousIndex, event.currentIndex);
    this.playlistService.moveVideo(event.previousIndex, event.currentIndex, this.UniqueId);
  }  

  PlayURL() {
    var videourl = document.getElementById('video-tooltip-input') as HTMLInputElement;
    if (!videourl || videourl.value.length === 0) {
      return;
    }
    var playerinput = document.getElementById('videoinput') as HTMLInputElement;
    if (!playerinput) {
      return;
    }
    playerinput.value = videourl.value;
    videourl.value = "";
    this.playerComp.PlayURL();
    this.showInput = false;
  }

  quickPlay() {
    navigator.clipboard.readText()
    .then(text => {
      var playerinput = document.getElementById('videoinput') as HTMLInputElement;
      if (!playerinput) {
        return;
      }
      playerinput.value = text;
      this.playerComp.PlayURL();
      this.showInput = false;
    })
    .catch(err => {
      console.error('Failed to read clipboard contents: ', err);
    });
  }

  PlayFile() {
    var filebtn = document.getElementById('playerFileBtn') as HTMLButtonElement;
    if (!filebtn) {
      return;
    }
    filebtn.click();
  }

}
