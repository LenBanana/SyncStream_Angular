import { Component, OnInit, Input, ViewChild, Output, EventEmitter, OnDestroy } from '@angular/core';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { PlaylistService } from '../playlist/playlist-service/playlist.service';
import { UserlistService } from '../userlist/userlist-service/userlist.service';
import { VideoDTO } from '../Interfaces/VideoDTO';
import { Member } from '../Interfaces/Member';
import { PlayerComponent } from '../player/player.component';
import { Location } from '@angular/common';
import { PlayerService } from '../player/player-service/player.service';

@Component({
  selector: 'app-side-nav',
  templateUrl: './side-nav.component.html',
  styleUrls: ['./side-nav.component.scss']
})
export class SideNavComponent implements OnInit, OnDestroy {

  constructor(public playlistService: PlaylistService, public playerService: PlayerService, public userService: UserlistService, private location: Location) { }

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
  @Output() Draw = new EventEmitter();
  @Output() goBack = new EventEmitter();
  Threshhold = false;
  showInput = false;
  showPlaylist = false;
  showUsername = false;
  showMemberlist = false;
  WhiteboardActive = false;
  BlackjackActive = false;
  playingGallows;
  playingBlackjack;

  ngOnInit(): void {
    if (this.IsHost) {      
      this.ThreshholdNumber = 2;
      this.threshholdChange.emit(this.ThreshholdNumber);
    } else {      
      this.ThreshholdNumber = .5;
      this.threshholdChange.emit(this.ThreshholdNumber);
    }    
    this.playingGallows = this.playerService.playingGallows.subscribe(playGallows => {
      if (playGallows == null||!playGallows) {
        return;
      }      
      if (playGallows=="$clearboard$") {        
        this.WhiteboardActive = false;
        return;
      } 
      this.BlackjackActive = false;
      this.WhiteboardActive = true;
    });

    this.playingBlackjack = this.playerService.playingBlackjack.subscribe(playBlackjack => {
      if (playBlackjack == null) {
        return;
      }
      if (playBlackjack === true) {
        this.WhiteboardActive = false;
        this.BlackjackActive = true;
      }
      if (playBlackjack === false) {
        this.BlackjackActive = false;
      }
    });
  } 

  ngOnDestroy() {
    this.playingGallows.unsubscribe();
    this.playingBlackjack.unsubscribe();
  }
  
  refresh(): void {
    this.goBack.emit();
  }

  enterMenu(enter) {
    this.menuEnter.emit(enter);
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
    if (this.showInput) {
      this.showInput = false;
    } else {
      this.ResetInputs();
      this.showInput = true;
    }
  }

  TogglePlaylist() {
    if (this.showPlaylist) {
      this.showPlaylist = false;
    } else {
      this.ResetInputs();
      this.showPlaylist = true;
    }
  }   

  ToggleThreshhold() {
    if (this.Threshhold) {
      this.Threshhold = false;
    } else {
      this.ResetInputs();
      this.Threshhold = true;
    }
  }   

  ToggleUsername() {
    if (this.showUsername) {
      this.showUsername = false;
    } else {
      this.ResetInputs();
      this.showUsername = true;
    }
  }  

  ToggleMemberlist() {
    if (this.showMemberlist) {
      this.showMemberlist = false;
    } else {
      this.ResetInputs();
      this.showMemberlist = true;
    }
  }  

  ResetInputs() {    
    if (this.showInput) {
      this.ToggleInput();
    }
    if (this.showPlaylist) {
      this.TogglePlaylist();
    }
    if (this.Threshhold) {
      this.ToggleThreshhold();
    }
    if (this.showUsername) {
      this.ToggleUsername();
    }
  }

  ChangeHost(username) {    
    this.userService.changeHost(username, this.UniqueId);   
  }
  
  toggleTwitchChat() {
    this.toggleTwitch.emit();
    setTimeout(() => {      
      var videourl = document.getElementById('textmessage') as HTMLInputElement;
      videourl.focus();
    }, 25);
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
    if (!navigator||!navigator.clipboard||!navigator.clipboard.readText) {
      this.showInput = true;
      return;
    }
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
