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
import {DragDropModule} from '@angular/cdk/drag-drop';
import { TwitchPlayerComponent } from './twitch-player/twitch-player.component';
import { SideNavComponent } from './side-nav/side-nav.component';
import { LoginModalComponent } from './login-modal/login-modal.component';
import { DownloadModalComponent } from './download-modal/download-modal.component';
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
    DownloadModalComponent,
    NetflixPlayerComponent,
    TextDialogComponent,
    VimeoPlayerComponent,
    HelpModalComponent,
    AddRoomModalComponent,
    WhiteboardComponent,
    UserAdminModalComponent,
    UserSettingModalComponent
  ],
  imports: [
    BrowserModule,
    HttpClientModule,
    FormsModule,
    AppRoutingModule,
    DragDropModule,
    CanvasWhiteboardModule,
    NgbModule
  ],
  providers: [DatePipe],
  bootstrap: [AppComponent]
})
export class AppModule { }
