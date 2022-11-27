import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'dateLive',
  pure: false
})
export class DateLivePipe implements PipeTransform {

  transform(value): any {
    if(!value) return null;
    var ms = Math.abs(new Date().getTime() - new Date(value).getTime()) + 10000;
    return ms;
  }

}
