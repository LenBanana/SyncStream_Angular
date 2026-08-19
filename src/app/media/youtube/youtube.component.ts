import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  ViewChild
} from '@angular/core';
import Plyr from 'plyr';
import { Subscription } from 'rxjs';
import { delay } from '../../helper/generic';
import { BrowserSettings, loadBrowserSettings, settingsUpdate } from '../../Interfaces/BrowserSettings';
import {
  sponsorBlockCategoryColors,
  sponsorBlockCategoryLabels,
  sponsorBlockCategoryOrder,
  SponsorBlockCategory,
  SponsorBlockSegment
} from '../../Interfaces/SponsorBlock';
import { VideoDTO } from '../../Interfaces/VideoDTO';
import { PlayerService } from '../../player/player-service/player.service';
import { PlayerType } from '../../player/player.component';
import { PlaylistService } from '../../playlist/playlist-service/playlist.service';
import { MediaService } from '../media-service/media.service';
import { SponsorBlockService } from './sponsor-block/sponsor-block.service';
import { YoutubePlayerService } from './youtube-player.service';
import { PlaybackSyncService } from '../../media/sync/playback-sync.service';
import { PlyrTarget } from '../../media/sync/playback-target';
import { startPlayback } from '../../media/sync/playback-start';

@Component({
  selector: 'app-youtube',
  templateUrl: './youtube.component.html',
  styleUrls: ['./youtube.component.scss']
})
export class YoutubeComponent implements AfterViewInit, OnDestroy, OnChanges {
  constructor(
    private hostRef: ElementRef<HTMLElement>,
    private playlistService: PlaylistService,
    private playerService: PlayerService,
    private mediaService: MediaService,
    private youtubePlayerService: YoutubePlayerService,
    private sponsorBlockService: SponsorBlockService,
    private playbackSync: PlaybackSyncService
  ) {
  }

  @ViewChild('youtubePlayerHost', { static: true }) youtubePlayerHost: ElementRef<HTMLElement>;
  @Input() CurrentPlayerType = PlayerType.Nothing;
  @Input() IsHost = false;
  @Input() UniqueId = '';
  @Output() PlayerReady = new EventEmitter<void>();

  PlayerType = PlayerType;
  BrowserSettings: BrowserSettings = loadBrowserSettings();
  IsPlaying = false;
  IsReady = false;
  SkipNoticeSegment: SponsorBlockSegment;

  private player: Plyr;
  private ServerTimeUpdate: Subscription;
  private IsPlayingUpdate: Subscription;
  private VideoUpdate: Subscription;
  private SponsorBlockUpdate: Subscription;
  private SettingsUpdate: Subscription;
  private Segments: SponsorBlockSegment[] = [];
  private CurrentVideoId = '';
  private markerRenderTimeout: ReturnType<typeof setTimeout>;
  private skipNoticeTimeout: ReturnType<typeof setTimeout>;
  private skippedSegments = new Map<string, { start: number; end: number }>();
  private suppressedSegments = new Map<string, { start: number; end: number }>();
  private pendingVideo: VideoDTO;
  private markerTooltipCleanup: () => void;
  private suppressStateSync = false;
  private shouldAutoplayOnReady = false;

  private readonly onReady = () => {
    this.IsReady = true;
    this.PlayerReady.emit();
    if (this.pendingVideo) {
      const video = this.pendingVideo;
      this.pendingVideo = undefined;
      this.applyVideoSource(video.url, video.title);
      return;
    }
    this.resumePlaybackIfNeeded();
    this.scheduleMarkerRender();
  };

  private readonly onPlay = () => {
    if (!this.player || this.CurrentPlayerType !== PlayerType.YouTube || this.suppressStateSync) {
      return;
    }
    if (this.IsHost) {
      this.playerService.PlayPause(true, this.UniqueId);
      return;
    }
    if (!this.IsPlaying) {
      this.player.pause();
    }
  };

  private readonly onPause = () => {
    if (!this.player || this.CurrentPlayerType !== PlayerType.YouTube || this.suppressStateSync) {
      return;
    }
    if (this.IsHost) {
      this.playerService.PlayPause(false, this.UniqueId);
      return;
    }
    if (this.IsPlaying) {
      startPlayback(() => this.player.play());
    }
  };

  private readonly onTimeUpdate = () => {
    if (!this.player || this.CurrentPlayerType !== PlayerType.YouTube) {
      return;
    }
    const currentTime = this.player.currentTime || 0;
    this.cleanupSegmentTracking(currentTime);
    this.updateMarkerPlayback(currentTime);
    if (!this.IsHost) {
      return;
    }
    if (this.trySkipSegment(currentTime)) {
      return;
    }
    if (currentTime > 0) {
      this.mediaService.playerTime.next(currentTime);
    }
  };

  private readonly onSeeked = () => {
    if (!this.IsHost || this.CurrentPlayerType !== PlayerType.YouTube) {
      return;
    }
    this.mediaService.playerTimeImmediate.next(this.player?.currentTime ?? 0);
  };

  private readonly onEnded = () => {
    this.hideSkipNotice();
    if (!this.IsHost || this.CurrentPlayerType !== PlayerType.YouTube) {
      return;
    }
    this.playlistService.nextVideo(this.UniqueId);
  };

  ngAfterViewInit(): void {
    this.addSubscriptions();
    this.SettingsUpdate = settingsUpdate.subscribe(() => {
      this.BrowserSettings = loadBrowserSettings();
      this.refreshSponsorBlockState();
    });
  }

  ngOnChanges() {
    if (this.player && this.CurrentPlayerType !== PlayerType.YouTube) {
      this.player.pause();
      this.hideSkipNotice();
    }
  }

  ngOnDestroy() {
    this.ServerTimeUpdate?.unsubscribe();
    this.IsPlayingUpdate?.unsubscribe();
    this.VideoUpdate?.unsubscribe();
    this.SponsorBlockUpdate?.unsubscribe();
    this.SettingsUpdate?.unsubscribe();
    clearTimeout(this.markerRenderTimeout);
    clearTimeout(this.skipNoticeTimeout);
    this.markerTooltipCleanup?.();
    if (!this.player) {
      return;
    }
    this.player.off('ready', this.onReady);
    this.player.off('play', this.onPlay);
    this.player.off('pause', this.onPause);
    this.player.off('timeupdate', this.onTimeUpdate);
    this.player.off('seeked', this.onSeeked);
    this.player.off('ended', this.onEnded);
    this.player.destroy();
  }

  JumpBackToSkippedSegment() {
    if (!this.player || !this.SkipNoticeSegment) {
      return;
    }
    const segment = this.SkipNoticeSegment;
    const targetTime = Math.max(0, segment.startTime + 0.01);
    this.suppressedSegments.set(segment.id, {
      start: segment.startTime,
      end: segment.endTime
    });
    this.player.currentTime = targetTime;
    this.mediaService.playerTime.next(targetTime);
    this.hideSkipNotice();
  }

  GetSkipNoticeLabel(): string {
    if (!this.SkipNoticeSegment) {
      return '';
    }
    return sponsorBlockCategoryLabels[this.SkipNoticeSegment.category] ?? this.SkipNoticeSegment.category;
  }

  private registerPlayerEvents() {
    this.player.on('ready', this.onReady);
    this.player.on('play', this.onPlay);
    this.player.on('pause', this.onPause);
    this.player.on('timeupdate', this.onTimeUpdate);
    this.player.on('seeked', this.onSeeked);
    this.player.on('ended', this.onEnded);
  }

  private addSubscriptions() {
    this.ServerTimeUpdate = this.playerService.currentTime.subscribe(sync => {
      if (!this.player || !this.IsReady || !sync || this.IsHost || this.CurrentPlayerType !== PlayerType.YouTube) {
        return;
      }
      this.playbackSync.apply(new PlyrTarget(this.player), sync);
    });

    this.IsPlayingUpdate = this.playerService.isplaying.subscribe(isplaying => {
      if (isplaying != null) {
        this.IsPlaying = isplaying;
      }
      if (!this.player || !this.IsReady || this.IsHost || this.CurrentPlayerType !== PlayerType.YouTube) {
        return;
      }
      if (isplaying) {
        startPlayback(() => this.player.play());
      } else if (!isplaying) {
        this.player.pause();
      }
    });

    this.VideoUpdate = this.playerService.player.subscribe(async vid => {
      await delay(10);
      if (this.CurrentPlayerType !== PlayerType.YouTube || !vid) {
        return;
      }
      this.loadVideo(vid.url, vid.title);
    });
  }

  private loadVideo(url: string, title: string) {
    this.hideSkipNotice();
    this.clearSegmentState();
    this.SponsorBlockUpdate?.unsubscribe();
    this.shouldAutoplayOnReady = this.IsHost || this.IsPlaying;
    const videoId = this.youtubePlayerService.extractVideoId(url);
    if (!videoId) {
      this.CurrentVideoId = '';
      this.Segments = [];
      this.shouldAutoplayOnReady = false;
      this.scheduleMarkerRender();
      return;
    }

    this.CurrentVideoId = videoId;
    if (!this.player) {
      this.suppressStateSync = true;
      this.player = this.youtubePlayerService.createPlayer(this.youtubePlayerHost.nativeElement, videoId);
      this.registerPlayerEvents();
      this.fetchSponsorBlockSegments(videoId);
      return;
    }

    if (!this.IsReady) {
      this.pendingVideo = { url, title };
      this.fetchSponsorBlockSegments(videoId);
      return;
    }

    this.applyVideoSource(url, title);
  }

  private applyVideoSource(url: string, title: string) {
    this.pendingVideo = undefined;
    this.suppressStateSync = true;
    const videoId = this.youtubePlayerService.setVideo(this.player, { url, title });
    if (!videoId) {
      this.CurrentVideoId = '';
      this.Segments = [];
      this.suppressStateSync = false;
      this.shouldAutoplayOnReady = false;
      this.scheduleMarkerRender();
      return;
    }
    this.CurrentVideoId = videoId;
    this.fetchSponsorBlockSegments(videoId);
  }

  private resumePlaybackIfNeeded() {
    this.suppressStateSync = false;
    if (!this.shouldAutoplayOnReady || !this.player || this.CurrentPlayerType !== PlayerType.YouTube) {
      this.shouldAutoplayOnReady = false;
      return;
    }

    this.shouldAutoplayOnReady = false;
    setTimeout(() => {
      if (!this.player || this.CurrentPlayerType !== PlayerType.YouTube) {
        return;
      }
      startPlayback(() => this.player.play());
    }, 0);
  }

  private fetchSponsorBlockSegments(videoId: string) {
    this.SponsorBlockUpdate?.unsubscribe();
    this.Segments = [];
    this.scheduleMarkerRender();
    if (!this.BrowserSettings.playbackSettings.sponsorBlock.enabled) {
      return;
    }
    this.SponsorBlockUpdate = this.sponsorBlockService.getSegments(videoId).subscribe(result => {
      if (result.videoId !== this.CurrentVideoId) {
        return;
      }
      this.Segments = result.segments.filter(segment => this.isSupportedCategory(segment.category));
      this.scheduleMarkerRender();
    });
  }

  private refreshSponsorBlockState() {
    this.hideSkipNotice();
    if (!this.BrowserSettings.playbackSettings.sponsorBlock.enabled) {
      this.SponsorBlockUpdate?.unsubscribe();
      this.Segments = [];
      this.clearSegmentState();
      this.scheduleMarkerRender();
      return;
    }
    if (this.CurrentVideoId && this.BrowserSettings.playbackSettings.sponsorBlock.enabled && this.Segments.length === 0) {
      this.fetchSponsorBlockSegments(this.CurrentVideoId);
      return;
    }
    this.scheduleMarkerRender();
  }

  private trySkipSegment(currentTime: number): boolean {
    const sponsorBlock = this.BrowserSettings.playbackSettings.sponsorBlock;
    if (!sponsorBlock.enabled || !this.player) {
      return false;
    }
    const activeSegments = this.Segments
      .filter(segment => segment.actionType === 'skip')
      .filter(segment => this.isCategoryEnabled(segment.category))
      .filter(segment => currentTime >= segment.startTime && currentTime < segment.endTime)
      .filter(segment => !this.skippedSegments.has(segment.id))
      .filter(segment => !this.suppressedSegments.has(segment.id))
      .sort((left, right) => right.endTime - left.endTime);

    const segment = activeSegments[0];
    if (!segment) {
      return false;
    }

    const targetTime = segment.endTime + 0.05;
    this.skippedSegments.set(segment.id, {
      start: segment.startTime,
      end: segment.endTime
    });
    this.player.currentTime = targetTime;
    this.mediaService.playerTime.next(targetTime);
    if (sponsorBlock.showSkipNotice) {
      this.showSkipNotice(segment);
    }
    return true;
  }

  private cleanupSegmentTracking(currentTime: number) {
    this.cleanupSegmentMap(this.skippedSegments, currentTime);
    this.cleanupSegmentMap(this.suppressedSegments, currentTime);
  }

  private cleanupSegmentMap(map: Map<string, { start: number; end: number }>, currentTime: number) {
    map.forEach((value, key) => {
      if (currentTime < (value.start - 0.25) || currentTime > (value.end + 0.5)) {
        map.delete(key);
      }
    });
  }

  private clearSegmentState() {
    this.skippedSegments.clear();
    this.suppressedSegments.clear();
  }

  private showSkipNotice(segment: SponsorBlockSegment) {
    this.SkipNoticeSegment = segment;
    clearTimeout(this.skipNoticeTimeout);
    this.skipNoticeTimeout = setTimeout(() => {
      this.SkipNoticeSegment = undefined;
    }, 5000);
  }

  private hideSkipNotice() {
    clearTimeout(this.skipNoticeTimeout);
    this.SkipNoticeSegment = undefined;
  }

  private scheduleMarkerRender() {
    clearTimeout(this.markerRenderTimeout);
    this.markerRenderTimeout = setTimeout(() => this.renderMarkers(), 0);
  }

  private renderMarkers() {
    const progressElement = this.hostRef.nativeElement.querySelector('.plyr__progress') as HTMLElement;
    const existing = this.hostRef.nativeElement.querySelector('.youtube-sponsorblock-markers');
    const existingTooltip = this.hostRef.nativeElement.querySelector('.youtube-sponsorblock-tooltip');
    existing?.remove();
    existingTooltip?.remove();
    this.markerTooltipCleanup?.();
    this.markerTooltipCleanup = undefined;
    if (!progressElement || !this.player) {
      return;
    }
    const sponsorBlock = this.BrowserSettings.playbackSettings.sponsorBlock;
    const duration = this.player.duration;
    if (!sponsorBlock.enabled || !sponsorBlock.showMarkers || !duration || !Number.isFinite(duration) || duration <= 0) {
      return;
    }

    const visibleSegments = this.Segments.filter(segment => this.isCategoryEnabled(segment.category));
    if (visibleSegments.length === 0) {
      return;
    }

    const track = document.createElement('div');
    track.className = 'youtube-sponsorblock-markers';
    const tooltip = document.createElement('div');
    tooltip.className = 'youtube-sponsorblock-tooltip';

    visibleSegments.forEach(segment => {
      const marker = document.createElement('span');
      marker.className = 'youtube-sponsorblock-markers__segment';
      const segmentColor = sponsorBlockCategoryColors[segment.category] ?? '#f97316';
      marker.dataset.startTime = segment.startTime.toString();
      marker.dataset.endTime = segment.endTime.toString();
      marker.dataset.segmentColor = segmentColor;
      marker.style.left = `${(segment.startTime / duration) * 100}%`;
      marker.style.width = `${Math.max(((segment.endTime - segment.startTime) / duration) * 100, 0.6)}%`;
      marker.style.background = segmentColor;
      track.appendChild(marker);
    });

    progressElement.appendChild(track);
    progressElement.appendChild(tooltip);
    this.updateMarkerPlayback(this.player.currentTime || 0);

    const onMouseMove = (event: MouseEvent) => {
      const rect = progressElement.getBoundingClientRect();
      if (rect.width <= 0) {
        return;
      }

      const relativeX = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
      const hoveredTime = (relativeX / rect.width) * duration;
      const hoveredSegment = visibleSegments.find(segment => hoveredTime >= segment.startTime && hoveredTime <= segment.endTime);

      if (!hoveredSegment) {
        tooltip.classList.remove('youtube-sponsorblock-tooltip--visible');
        return;
      }

      tooltip.textContent = this.getMarkerTooltipLabel(hoveredSegment);
      tooltip.style.left = `${(relativeX / rect.width) * 100}%`;
      tooltip.classList.add('youtube-sponsorblock-tooltip--visible');
    };

    const onMouseLeave = () => {
      tooltip.classList.remove('youtube-sponsorblock-tooltip--visible');
    };

    progressElement.addEventListener('mousemove', onMouseMove);
    progressElement.addEventListener('mouseleave', onMouseLeave);
    this.markerTooltipCleanup = () => {
      progressElement.removeEventListener('mousemove', onMouseMove);
      progressElement.removeEventListener('mouseleave', onMouseLeave);
    };
  }

  private updateMarkerPlayback(currentTime: number) {
    const markers = Array.from(this.hostRef.nativeElement.querySelectorAll('.youtube-sponsorblock-markers__segment')) as HTMLElement[];
    markers.forEach(marker => {
      const startTime = Number(marker.dataset.startTime);
      const endTime = Number(marker.dataset.endTime);
      const segmentColor = marker.dataset.segmentColor ?? '#f97316';
      const duration = endTime - startTime;

      if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || duration <= 0) {
        marker.style.background = segmentColor;
        return;
      }

      const playedPercent = Math.min(Math.max(((currentTime - startTime) / duration) * 100, 0), 100);
      marker.style.background = `linear-gradient(to right, var(--youtube-sponsorblock-played-color, rgba(59, 130, 246, 0.68)) 0%, var(--youtube-sponsorblock-played-color, rgba(59, 130, 246, 0.68)) ${playedPercent}%, transparent ${playedPercent}%, transparent 100%), ${segmentColor}`;
    });
  }

  private getMarkerTooltipLabel(segment: SponsorBlockSegment): string {
    const label = sponsorBlockCategoryLabels[segment.category] ?? segment.category;
    return `${label} ${this.formatTime(segment.startTime)} - ${this.formatTime(segment.endTime)}`;
  }

  private formatTime(time: number): string {
    const totalSeconds = Math.max(0, Math.floor(time));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  private isSupportedCategory(category: string): category is SponsorBlockCategory {
    return sponsorBlockCategoryOrder.includes(category as SponsorBlockCategory);
  }

  private isCategoryEnabled(category: SponsorBlockCategory): boolean {
    return this.BrowserSettings.playbackSettings.sponsorBlock.categories[category] !== false;
  }
}
