import { Injectable } from '@angular/core';
import Plyr from 'plyr';
import { VideoDTO } from '../../Interfaces/VideoDTO';

@Injectable({
  providedIn: 'root'
})
export class YoutubePlayerService {
  createPlayer(target: HTMLElement, videoId?: string): Plyr {
    target.setAttribute('data-plyr-provider', 'youtube');
    if (videoId) {
      target.setAttribute('data-plyr-embed-id', videoId);
    } else {
      target.removeAttribute('data-plyr-embed-id');
    }

    return new Plyr(target, {
      autoplay: true,
      disableContextMenu: false,
      keyboard: {
        focused: true,
        global: true
      },
      invertTime: false,
      ratio: '16:9',
      youtube: {
        noCookie: false,
        playsinline: 1,
        rel: 0,
        iv_load_policy: 3,
        modestbranding: 1
      }
    } as any);
  }

  setVideo(player: Plyr, video: VideoDTO): string | null {
    const videoId = this.extractVideoId(video?.url);
    if (!videoId) {
      return null;
    }
    player.source = {
      title: video.title,
      type: 'video',
      sources: [{
        src: videoId,
        provider: 'youtube'
      }]
    } as any;
    return videoId;
  }

  extractVideoId(url: string): string | null {
    if (!url) {
      return null;
    }
    if (/^[A-Za-z0-9_-]{11}$/.test(url)) {
      return url;
    }
    const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
    const match = url.match(regExp);
    return match && match[7] && match[7].length === 11 ? match[7] : null;
  }
}