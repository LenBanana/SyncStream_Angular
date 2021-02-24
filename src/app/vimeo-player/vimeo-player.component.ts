import { Component, OnInit } from '@angular/core';
import * as Player from "@vimeo/player/dist/player.js";

@Component({
  selector: 'app-vimeo-player',
  templateUrl: './vimeo-player.component.html',
  styleUrls: ['./vimeo-player.component.scss']
})
export class VimeoPlayerComponent implements OnInit {

  constructor() { }

  ngOnInit(): void {
    var iframe = document.getElementById('vimeo-player');
    var player = new Player(iframe);

    player.on('play', function() {

    });

    player.getVideoTitle().then(function(title) {
      
    });
  }

}
