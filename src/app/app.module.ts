import { BrowserModule } from '@angular/platform-browser';
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { HomeComponent } from './home/home.component';
import { RoomsComponent } from './rooms/rooms.component';
import { HttpClientModule } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { SafePipe } from './pipes/safe-urlpipe.pipe';
import { PlaylistComponent } from './playlist/playlist.component';
import { PlayerComponent } from './player/player.component';
import { DreckchatComponent } from './dreckchat/dreckchat.component';
import { UserlistComponent } from './userlist/userlist.component';
import {CDK_DRAG_CONFIG, DragDropModule} from '@angular/cdk/drag-drop';
import { TwitchPlayerComponent } from './twitch-player/twitch-player.component';
import { SideNavComponent } from './side-nav/side-nav.component';
import { LoginModalComponent } from './login-modal/login-modal.component';
import { NetflixPlayerComponent } from './iframe-players/netflix-player/netflix-player.component';
import { TextDialogComponent } from './text-dialog/text-dialog.component';
import { VimeoPlayerComponent } from './vimeo-player/vimeo-player.component';
import { HelpModalComponent } from './help-modal/help-modal.component';
import { AddRoomModalComponent } from './add-room-modal/add-room-modal.component';
import { WhiteboardComponent } from './whiteboard/whiteboard.component';
import { CanvasWhiteboardModule } from 'ng2-canvas-whiteboard';
import { UserAdminModalComponent } from './user-admin-modal/user-admin-modal.component';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { UserSettingModalComponent } from './user-setting-modal/user-setting-modal.component';
import { SpotifyPlayerComponent } from './spotify-player/spotify-player.component';
import { BlackjackGameComponent } from './blackjack-game/blackjack-game.component';
import { BjPlayingCardsComponent } from './bj-playing-cards/bj-playing-cards.component';
import { ChessGameComponent } from './chess-game/chess-game.component';
import { NgxChessBoardModule } from 'ngx-chess-board';
import { DownloadManagerComponent } from './download-manager/download-manager.component';
import { FileFolderComponent } from './file-folder/file-folder.component';
import { FileViewComponent } from './file-view/file-view.component';
import { MatMenuModule } from '@angular/material/menu';
import { BrowserAnimationsModule, NoopAnimationsModule } from '@angular/platform-browser/animations';
import { BrowserResultModalComponent } from './browser-result-modal/browser-result-modal.component';
import { MediaComponent } from './media/media.component';
import { YoutubeComponent } from './media/youtube/youtube.component';
import { PlyrPlayerComponent } from './media/plyr-player/plyr-player.component';
import { TwitchComponent } from './media/twitch/twitch.component';
import { FileInfoPipe } from './file-view/file-info-pipe/file-info.pipe';
import { Html5PlayerComponent } from './media/html5-player/html5-player.component';
import { VideojsPlayerComponent } from './media/videojs-player/videojs-player.component';
import { MpegtsPlayerComponent } from './media/mpegts-player/mpegts-player.component';
import { LiveStreamViewComponent } from './live-stream-view/live-stream-view.component';
import { DateLivePipe } from './live-stream-view/date-live-pipe/date-live.pipe';
import { WebrtcComponent } from './media/webrtc/webrtc.component';
import { MediaEditorComponent } from './media-editor/media-editor.component';
import { PermissionViewComponent } from './permission-view/permission-view.component';
import { FilestorageViewComponent } from './filestorage-view/filestorage-view.component';
import { NgbdSortableHeader } from './Interfaces/SortableHeader';
import { LiveStreamDirectComponent } from './media/live-stream-direct/live-stream-direct.component';
const DragConfig = {
  dragStartThreshold: 0,
  pointerDirectionChangeThreshold: 5,
  zIndex: 10000
};
@NgModule({
  declarations: [
    AppComponent,
    HomeComponent,
    RoomsComponent,
    SafePipe,
    PlaylistComponent,
    PlayerComponent,
    DreckchatComponent,
    UserlistComponent,
    TwitchPlayerComponent,
    SideNavComponent,
    LoginModalComponent,
    NetflixPlayerComponent,
    TextDialogComponent,
    VimeoPlayerComponent,
    HelpModalComponent,
    AddRoomModalComponent,
    WhiteboardComponent,
    UserAdminModalComponent,
    UserSettingModalComponent,
    SpotifyPlayerComponent,
    BlackjackGameComponent,
    BjPlayingCardsComponent,
    ChessGameComponent,
    DownloadManagerComponent,
    FileFolderComponent,
    FileViewComponent,
    BrowserResultModalComponent,
    MediaComponent,
    YoutubeComponent,
    PlyrPlayerComponent,
    TwitchComponent,
    FileInfoPipe,
    Html5PlayerComponent,
    VideojsPlayerComponent,
    MpegtsPlayerComponent,
    LiveStreamViewComponent,
    DateLivePipe,
    WebrtcComponent,
    MediaEditorComponent,
    PermissionViewComponent,
    FilestorageViewComponent,
    LiveStreamDirectComponent
  ],
  imports: [
    MatMenuModule,
    BrowserModule,
    HttpClientModule,
    FormsModule,
    AppRoutingModule,
    DragDropModule,
    CanvasWhiteboardModule,
    NgbModule,
    NgxChessBoardModule.forRoot(),
    BrowserAnimationsModule,
    NoopAnimationsModule,
    NgbdSortableHeader
  ],
  providers: [DatePipe,{  provide: CDK_DRAG_CONFIG, useValue: DragConfig }],
  bootstrap: [AppComponent]
})
export class AppModule { }
