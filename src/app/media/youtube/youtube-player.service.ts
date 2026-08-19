import { Injectable } from '@angular/core';
import Plyr from 'plyr';
import { VideoDTO } from '../../Interfaces/VideoDTO';

@Injectable({
  providedIn: 'root'
})
export class YoutubePlayerService {
  /**
   * @param captionsEnabled Whether the video should start with captions showing. Passed to the embed at
   *   creation, because YouTube offers no dependable way to change it in a running player.
   */
  createPlayer(target: HTMLElement, videoId?: string, captionsEnabled = false): Plyr {
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

      // Plyr only really handles captions for HTML5 sources; for YouTube it leaves them to the embed. Saying so
      // here stops Plyr from showing a captions control that does not drive anything.
      captions: {
        active: captionsEnabled,
        update: false
      },
      youtube: {
        noCookie: false,
        playsinline: 1,
        rel: 0,
        iv_load_policy: 3,
        modestbranding: 1,

        // Stated in both directions. Unset, YouTube falls back to the viewer's own preference, which is how
        // captions switched themselves on with nothing here asking for them.
        cc_load_policy: captionsEnabled ? 1 : 0
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