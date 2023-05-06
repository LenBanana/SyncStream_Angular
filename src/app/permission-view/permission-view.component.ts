import { Component, OnDestroy, OnInit, QueryList, ViewChildren } from '@angular/core';
import { PermissionViewService, PrivilegeInfo } from './permission-service/permission-view.service';
import { Subscription } from 'rxjs';
import { AuthenticationType, UserPrivileges } from '../user-admin-modal/user-admin-modal.component';
import { NgbdSortableHeader, SortEvent, compare } from '../Interfaces/SortableHeader';
declare var $: any;

@Component({
  selector: 'app-permission-view',
  templateUrl: './permission-view.component.html',
  styleUrls: ['./permission-view.component.scss']
})
export class PermissionViewComponent implements OnInit, OnDestroy {

  permissions: PrivilegeInfo[] = [];
  constPerm: PrivilegeInfo[] = [];
  permissionInfo: Subscription;
  @ViewChildren(NgbdSortableHeader) headers: QueryList<NgbdSortableHeader>;
  constructor(private permissionService: PermissionViewService) { }

  ngOnInit(): void {
    this.permissionInfo = this.permissionService.privilegeInfos.subscribe(p => {
      if (!p || p == null) {
        return;
      }
      p.forEach(f => {
        f.methodName = this.capitalizeFirstLetter(f.methodName);
      });
      this.permissions = p;
      this.constPerm = [...p];
    });
    $( "#permissionInfoModal" ).on('shown.bs.modal', () => {
      this.GetPermissions()
    });
  }

  capitalizeFirstLetter(string: string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
  }

  ngOnDestroy(): void {
      this.permissionInfo.unsubscribe();
      $( "#permissionInfoModal" ).off();
  }

  GetPermissions() {
    this.permissionService.GetPermissions();
  }

  GetPrivilegeString(p: number) {
    var priv = UserPrivileges[p];
    return priv.toString();
  }
  GetAuthString(p: number) {
    var auth = AuthenticationType[p];
    return auth.toString();
  }

	onSort({ column, direction }: SortEvent) {
		this.headers.forEach((header) => {
			if (header.sortable !== column) {
				header.direction = '';
			}
		});
		if (direction === '' || column === '') {
			this.permissions = [...this.constPerm];
		} else {
			this.permissions = [...this.permissions].sort((a, b) => {
				const res = compare(a[column], b[column]);
				return direction === 'asc' ? res : -res;
			});
		}
	}
}
