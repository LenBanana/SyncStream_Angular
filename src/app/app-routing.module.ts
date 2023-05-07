import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { RoomsComponent } from './rooms/rooms.component';
import { HomeComponent } from './home/home.component';
import { LiveStreamDirectComponent } from './media/live-stream-direct/live-stream-direct.component';


const routes: Routes = [
  { path: 'live/:UniqueId', component: LiveStreamDirectComponent, pathMatch: 'full' },
  { path: 'room/:UniqueId', component: RoomsComponent, pathMatch: 'full' },
  { path: '**', component: RoomsComponent}
];

@NgModule({
  imports: [RouterModule.forRoot(routes, {useHash: false})],
  exports: [RouterModule]
})
export class AppRoutingModule { }
