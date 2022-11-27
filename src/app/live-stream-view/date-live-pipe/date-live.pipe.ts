import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'dateLive'
})
export class DateLivePipe implements PipeTransform {
  transform(date1, date2): any {
    if(!date1||!date2) return null;
    var ms = new Date(date2).getTime() - new Date(date1).getTime() + 12000;
    return ms;
  }

}
