import { Component, OnInit, Input, OnDestroy, Output, EventEmitter, AfterViewChecked, ChangeDetectorRef, ViewChild, HostListener, OnChanges } from '@angular/core';
import { DatePipe } from '@angular/common';
import $ from 'jquery';
import { hubConnection, SignalRService } from '../services/signal-r.service';
import { PlaylistService } from '../playlist/playlist-service/playlist.service';
import { UserlistService } from '../userlist/userlist-service/userlist.service';
import { player, PlayerComponent } from '../player/player.component';
import { Location } from '@angular/common';
import { Member } from '../Interfaces/Member';
import { VideoDTO } from '../Interfaces/VideoDTO';
import { ActivatedRoute, Router } from '@angular/router';
import { randomIntFromInterval } from '../helper/generic';
import { MainUser } from '../helper/Globals';
import { DialogService } from '../text-dialog/text-dialog-service/dialog-service.service';
import { BrowserSettings, changeSettings, GeneralSettings } from '../Interfaces/BrowserSettings';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent implements OnInit, OnDestroy, AfterViewChecked, OnChanges {


  @ViewChild(PlayerComponent) playerComp;
  constructor(private route: ActivatedRoute, public datepipe: DatePipe, private router: Router, public signalRService: SignalRService, public dialogService: DialogService, public playlistService: PlaylistService, public userService: UserlistService, private cdRef: ChangeDetectorRef, private location: Location) {

  }

  ytHeader: string = "?origin=https://plyr.io&amp;iv_load_policy=3&amp;modestbranding=1&amp;playsinline=1&amp;showinfo=0&amp;rel=0&amp;autoplay=1&amp;enablejsapi=1";
  @Input() UniqueId: string;
  @Input() DelInterval: boolean;
  @Input() currentTime: number;
  @Input() Username: string;
  @Input() logout: boolean;
  @Input() Privileges: number;
  @Input() BrowserSettings: BrowserSettings;
  @Output() IntervalOff = new EventEmitter();
  @Output() isInMenu = new EventEmitter();
  @Output() goBack = new EventEmitter();
  Members: Member[] = [];
  inMenu = false;
  IsHost: boolean = false;
  nav: boolean = false;
  fullscreen: boolean = false;
  isPlaying = false;
  twitchChat = false;
  Playlist: VideoDTO[] = [];
  Threshhold: number = 0.5;
  currentTimeout;
  UserAdded = false;
  loginRequest;

  @HostListener('document:mousemove', ['$event'])
  onMouseMove(e) {
    if (this.currentTimeout) {
      clearTimeout(this.currentTimeout);
    }
    if (this.fullscreen==true&&this.nav==false) {
      this.fullscreen = false;
      this.isInMenu.emit(true);
    }
    if (this.fullscreen==false&&this.nav==false&&this.inMenu==false) {
      this.currentTimeout = setTimeout(() => {
        this.fullscreen = true;
        this.isInMenu.emit(false);
      }, 2000);
    }
  }

  ngOnChanges() {
    if (this.isPlaying==false) {
      this.fullscreen = false;
    }
  }

  DrawWhiteboard() {
    this.playerComp.DrawWhiteboard();
  }

  userIntervalOff() {
    this.IntervalOff.emit();
  }

  refresh(): void {
    this.goBack.emit();
  }

  ngOnInit() {
    if (!this.BrowserSettings.generalSettings) {
      this.BrowserSettings.generalSettings = new GeneralSettings();
    }
    if (this.BrowserSettings.generalSettings.firstVisit) {
      $('#text-total-overlay').removeClass('none');
      setTimeout(() => {
        $('#text-total-overlay').removeClass('hide');
        $('#text-total-overlay').addClass('show');
        setTimeout(() => {
          $('#text-total-overlay').addClass('hide');
          $('#text-total-overlay').removeClass('show');
          setTimeout(() => {
            $('#text-total-overlay').addClass('none');
          }, 500);
        }, 3500);
      }, 10);
      this.BrowserSettings.generalSettings.firstVisit = false;
      changeSettings(this.BrowserSettings);
    }
  }

  menuEnter(enter) {
    this.inMenu=enter;
  }

  ChangeHost(isHost: boolean) {
    this.IsHost = isHost;
    if (this.IsHost) {
      this.Threshhold = 2;
    } else {
      this.Threshhold = .5;
    }
  }

  ngAfterViewChecked() {
    this.cdRef.detectChanges();
  }

  ngOnDestroy() {
  }

  toggleNav() {
    if (this.nav) {
      this.nav = false;
    } else {
      this.nav = true;
      this.fullscreen==false
    }
  }


}









