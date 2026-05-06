import {Pipe, PipeTransform} from '@angular/core';
import {SourceOption} from './stream-start-dialog.component';

@Pipe({name: 'sourceLabel'})
export class SourceLabelPipe implements PipeTransform {
  transform(sources: SourceOption[], selectedId: string | null): string {
    if (!selectedId || !sources) return '—';
    return sources.find(s => s.id === selectedId)?.label ?? '—';
  }
}
