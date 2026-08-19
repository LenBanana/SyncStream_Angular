import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';

import { YoutubeComponent } from './youtube.component';
import { PlayerService } from '../../player/player-service/player.service';
import { PlaylistService } from '../../playlist/playlist-service/playlist.service';
import { MediaService } from '../media-service/media.service';
import { YoutubePlayerService } from './youtube-player.service';
import { SponsorBlockService } from './sponsor-block/sponsor-block.service';
import { PlayerType } from '../../Interfaces/PlayerType';
import { TimeSync } from '../sync/time-sync';

class PlyrStub {
  currentTime = 0;
  duration = 100;

  on() {
  }

  off() {
  }

  play() {
  }

  pause() {
  }

  destroy() {
  }

  set source(value: any) {
  }
}

describe('YoutubeComponent', () => {
  let component: YoutubeComponent;
  let fixture: ComponentFixture<YoutubeComponent>;
  let youtubePlayerServiceMock: {
    createPlayer: jasmine.Spy;
    setVideo: jasmine.Spy;
    extractVideoId: jasmine.Spy;
  };
  let playerServiceMock: {
    currentTime: BehaviorSubject<TimeSync>;
    isplaying: BehaviorSubject<boolean>;
    player: BehaviorSubject<any>;
    PlayPause: jasmine.Spy;
  };
  let playlistServiceMock: {
    nextVideo: jasmine.Spy;
  };
  let mediaServiceMock: {
    playerTime: BehaviorSubject<number>;
    playerTimeImmediate: BehaviorSubject<number>;
  };

  beforeEach(async () => {
    playerServiceMock = {
      currentTime: new BehaviorSubject<TimeSync>(null),
      isplaying: new BehaviorSubject<boolean>(null),
      player: new BehaviorSubject<any>(null),
      PlayPause: jasmine.createSpy('PlayPause')
    };
    playlistServiceMock = {
      nextVideo: jasmine.createSpy('nextVideo')
    };
    mediaServiceMock = {
      playerTime: new BehaviorSubject<number>(null),
      playerTimeImmediate: new BehaviorSubject<number>(null)
    };
    youtubePlayerServiceMock = {
      createPlayer: jasmine.createSpy('createPlayer').and.callFake(() => new PlyrStub()),
      setVideo: jasmine.createSpy('setVideo').and.returnValue('abc123def45'),
      extractVideoId: jasmine.createSpy('extractVideoId').and.returnValue('abc123def45')
    };

    await TestBed.configureTestingModule({
      declarations: [ YoutubeComponent ],
      providers: [
        {
          provide: PlayerService,
          useValue: playerServiceMock
        },
        {
          provide: PlaylistService,
          useValue: playlistServiceMock
        },
        {
          provide: MediaService,
          useValue: mediaServiceMock
        },
        {
          provide: YoutubePlayerService,
          useValue: youtubePlayerServiceMock
        },
        {
          provide: SponsorBlockService,
          useValue: {
            getSegments: () => of({ videoId: 'abc123def45', fetchedAtUtc: new Date().toISOString(), segments: [] })
          }
        }
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(YoutubeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render a youtube host container for Plyr enhancement', () => {
    const host = fixture.nativeElement.querySelector('.youtube-player__embed');

    expect(host).toBeTruthy();
  });

  it('should create the player when the first youtube video arrives', () => {
    component.CurrentPlayerType = PlayerType.YouTube;

    component['loadVideo']('https://www.youtube.com/watch?v=abc123def45', 'Video');

    expect(youtubePlayerServiceMock.createPlayer).toHaveBeenCalled();
    expect(component['player']).toBeTruthy();
  });

  it('should autoplay for hosts when the player becomes ready', fakeAsync(() => {
    const player = new PlyrStub() as any;
    spyOn(player, 'play');

    component.CurrentPlayerType = PlayerType.YouTube;
    component.IsHost = true;
    component['player'] = player;
    component['shouldAutoplayOnReady'] = true;

    component['onReady']();
    tick();

    expect(player.play).toHaveBeenCalled();
  }));

  it('should accept a report that the room is at zero', () => {
    // Position zero is a real position, not a missing one. A host at the very start of a video, or one that
    // just seeked back to it, reports zero, and treating that as nothing left viewers stranded wherever they
    // happened to be. The report is an object now rather than a bare number, so the guard against a missing
    // report no longer has to distinguish the two.
    component.CurrentPlayerType = PlayerType.YouTube;
    component.IsHost = false;
    component.IsReady = true;
    component['player'] = new PlyrStub() as any;
    component['player'].currentTime = 5;

    playerServiceMock.currentTime.next({ mediaTime: 0, ageMs: 0, isPlaying: true });

    expect(component['player'].currentTime).toBe(0);
  });

  it('should ignore a missing report', () => {
    component.CurrentPlayerType = PlayerType.YouTube;
    component.IsHost = false;
    component.IsReady = true;
    component['player'] = new PlyrStub() as any;
    component['player'].currentTime = 5;

    playerServiceMock.currentTime.next(null);

    expect(component['player'].currentTime).toBe(5);
  });

  it('should skip enabled SponsorBlock segments for hosts', () => {
    component.CurrentPlayerType = PlayerType.YouTube;
    component.IsHost = true;
    component['player'] = new PlyrStub() as any;
    component['player'].currentTime = 12;
    component['Segments'] = [{
      id: 'segment-1',
      category: 'sponsor',
      actionType: 'skip',
      startTime: 10,
      endTime: 15,
      votes: 1,
      locked: false,
      description: ''
    }];

    component['onTimeUpdate']();

    expect(component['player'].currentTime).toBeCloseTo(15.05, 2);
    expect(mediaServiceMock.playerTime.getValue()).toBeCloseTo(15.05, 2);
    expect(component.SkipNoticeSegment?.id).toBe('segment-1');
  });
});
