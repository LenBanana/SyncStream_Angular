import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { RoomsComponent } from './rooms/rooms.component';
import { HomeComponent } from './home/home.component';


const routes: Routes = [
  { path: 'room/:UniqueId', component: RoomsComponent, pathMatch: 'full' },
  { path: '**', component: RoomsComponent}
];

@NgModule({
  imports: [RouterModule.forRoot(routes, {useHash: false})],
  exports: [RouterModule]
})
export class AppRoutingModule { }
