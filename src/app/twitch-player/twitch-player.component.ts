import { Component, Input, OnChanges, OnInit } from '@angular/core';

@Component({
  selector: 'app-twitch-player',
  templateUrl: './twitch-player.component.html',
  styleUrls: ['./twitch-player.component.scss']
})
export class TwitchPlayerComponent implements OnChanges {

  constructor() { }
  @Input() channel = "";
  @Input() chat = false;

  ngOnChanges() {
    setTimeout(() => {      
      var player = document.getElementById('twitchPlayer') as HTMLIFrameElement;
      const newStream = "https://player.twitch.tv/?channel=" + this.channel + "&parent=dreckbu.de";
      if (player.src !== newStream) {      
        player.src = newStream;
      }
      if (this.chat==true) {
        var chat = document.getElementById('twitchChat') as HTMLIFrameElement;      
        const newChat = "https://www.twitch.tv/embed/" + this.channel + "/chat?parent=dreckbu.de&darkpopout";;
        if (chat.src !== newChat) {      
          chat.src = newChat;
        }  
      }
    }, 10); 
    
  }

}
