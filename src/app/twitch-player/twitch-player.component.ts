import { THIS_EXPR } from '@angular/compiler/src/output/output_ast';
import { Component, EventEmitter, Input, OnChanges, OnDestroy, OnInit, Output, SimpleChanges } from '@angular/core';
import { TwitchPlayer, TwitchPlayerEvent } from 'twitch-player';
import { PlayerService } from '../player/player-service/player.service';
import { TwitchService } from './twitch-player-service/twitch-service.service';

@Component({
  selector: 'app-twitch-player',
  templateUrl: './twitch-player.component.html',
  styleUrls: ['./twitch-player.component.scss']
})
export class TwitchPlayerComponent implements OnChanges, OnInit, OnDestroy {

  constructor(public twitchService: TwitchService, public playerService: PlayerService) { }
  @Input() channel = "";
  @Input() chat = false;
  @Input() videoID = "";
  @Input() IsHost = false;
  @Input() UniqueId: string;
  @Input() Threshhold: number;
  @Output() isPlaying = new EventEmitter();
  PlayingEvent;
  TimeEvent;
  TimeInterval: NodeJS.Timeout;
  player: TwitchPlayer;
  LiveStream = false;
  IsPlaying = false;
  CurrentTime = 0;

  ngOnInit() {
    this.PlayingEvent = this.twitchService.Playing.subscribe(isPlaying => {
      if (isPlaying===null||this.IsHost) {
        return;
      }
      this.IsPlaying = isPlaying;
      this.isPlaying.emit(isPlaying);
      if (isPlaying===true) {
        this.player.play();
      } else if (isPlaying === false) {
        this.player.pause();
      }
    });

    this.TimeEvent = this.twitchService.Time.subscribe(time => {
      if (time===null||this.IsHost) {
        return;
      }
      const playerTime = this.player.getCurrentTime();      
      if ((playerTime > (time + 2) || playerTime < (time - 2))) {
        this.player.seek(time);
      }
    });
    
    this.TimeInterval = setInterval(() => {
        if (this.player && this.IsHost) {
          const time = this.player.getCurrentTime();
          if (time !== this.CurrentTime) {
            this.playerService.SetTime(time, this.UniqueId);
          }
        }
    }, 500);
    this.twitchService.addPlayingListener();
    this.twitchService.addTimeListener();
  }

  ngOnDestroy() {
    this.twitchService.removePlayingListener();
    this.twitchService.removeTimeListener();
    this.PlayingEvent.unsubscribe();
  }

  ngOnChanges(changes: SimpleChanges) {
    setTimeout(() => {      
      if (changes.channel !== undefined && changes.channel.currentValue.length !== 0) {
          this.LiveStream = true;
          setTimeout(() => {            
            var player = document.getElementById('twitchPlayer') as HTMLIFrameElement;
            const newStream = "https://player.twitch.tv/?channel=" + this.channel + "&parent=dreckbu.de";
            player.src = newStream;
          }, 10);
      }
      if (this.chat==true) {
        var chat = document.getElementById('twitchChat') as HTMLIFrameElement;      
        const newChat = "https://www.twitch.tv/embed/" + this.channel + "/chat?parent=dreckbu.de&darkpopout";;
        if (chat.src !== newChat) {      
          chat.src = newChat;
        }  
      }
    }, 10); 
    
    if (changes.videoID !== undefined && changes.videoID.currentValue && changes.videoID.currentValue.length !== 0) {
      this.LiveStream = false;
      setTimeout(() => {       
      this.player = TwitchPlayer.FromOptions('twitchVODPlayer', {
        width: "100%",
        height: "100%",
        video: this.videoID
      });
      this.player.addEventListener(TwitchPlayerEvent.PLAY, () => {
        if (!this.IsHost && !this.IsPlaying) {
          this.player.pause();
          return;
        }
        this.isPlaying.emit(true);
      });

      
      this.player.addEventListener(TwitchPlayerEvent.PAUSE, () => {
        if (!this.IsHost && this.IsPlaying) {
          this.player.play();
          return;
        }
        this.isPlaying.emit(false);
      });
      }, 1000);
    }
  }

}
