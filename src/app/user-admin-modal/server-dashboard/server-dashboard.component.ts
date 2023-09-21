import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { UserAdminService } from '../user-admin-service/user-admin.service';
import { ServerHealth } from '../../Interfaces/ServerHealth';

@Component({
  selector: 'app-server-dashboard',
  templateUrl: './server-dashboard.component.html',
  styleUrls: ['./server-dashboard.component.scss']
})
export class ServerDashboardComponent implements OnInit, OnDestroy {

  constructor(private userAdminService: UserAdminService) { }

  ServerHealth: ServerHealth;
  serverHealthUpdate: Subscription;

  ngOnInit(): void {
    this.serverHealthUpdate = this.userAdminService.ServerHealth.subscribe(health => {
      if (!health) {
        return;
      }
      this.ServerHealth = health;
    });
  }

  ngOnDestroy(): void {
    this.serverHealthUpdate.unsubscribe();
  }

}
