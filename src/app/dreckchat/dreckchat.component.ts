import {
  Component,
  OnInit,
  Input,
  OnDestroy,
  Output,
  EventEmitter
} from '@angular/core';
import {
  DreckchatService
} from './dreckchat-service/dreckchat.service';
import {
  ChatMessage
} from '../Interfaces/Chatmessage';
import { Language } from '../Interfaces/Language';
import { Observable, OperatorFunction } from 'rxjs';
import { debounceTime, distinctUntilChanged, map } from 'rxjs/operators';
import { UserlistService } from '../userlist/userlist-service/userlist.service';
import { Member } from '../Interfaces/Member';
import { smileys } from '../global.settings';
declare var $: any;

@Component({
  selector: 'app-dreckchat',
  templateUrl: './dreckchat.component.html',
  styleUrls: ['./dreckchat.component.scss']
})
export class DreckchatComponent implements OnInit, OnDestroy {

  constructor(public chatService: DreckchatService, public userlistService: UserlistService) {}

  @Input() UniqueId: string;
  @Input() Username: string;
  @Input() nav: boolean;
  @Input() logout: boolean;
  @Input() WhiteBoard: boolean;
  @Output() NewMessage = new EventEmitter();
  @Output() ChangeToAi = new EventEmitter();
  Messages: ChatMessage[] = [];
  CurrentDate: Date = new Date();
  smileyCategories = smileys;
  showSmileys: boolean = false;
  messages: any;
  message: any;
  memberUpdate: any;
  members: Member[];
  public chatBoxModel: any;

  search: OperatorFunction<string, readonly string[]> = (
    text$: Observable<string>
  ) =>
    text$.pipe(
      debounceTime(200),
      distinctUntilChanged(),
      map((term) =>
        term.length < 2
          ? []
          : this.members.filter(x => x.username != this.Username).map(x => "/w " + x.username + " ")
              .filter((v) => v.toLowerCase().indexOf(term.toLowerCase()) > -1)
              .slice(0, 10)
      )
    );

  ngOnInit(): void {
    this.memberUpdate = this.userlistService.members.subscribe(m => {
      if (!m || m == null) {
        return;
      }
      this.members = m;
    });
    this.messages = this.chatService.messages.subscribe(result => {
      this.Messages = result;
      setTimeout(() => $('#messagebox').scrollTop($('#messagebox')[0]?.scrollHeight), 100);
    });
    this.message = this.chatService.message.subscribe(result => {
      if (result == null) {
        return;
      }
      if (this.Messages==null) {
        this.Messages = [];
      }
      this.Messages.push(result);
      this.NewMessage.emit();
      if (this.Messages.length >= 100) {
        this.Messages.shift();
      }
      setTimeout(() => $('#messagebox').scrollTop($('#messagebox')[0]?.scrollHeight), 100);
    });
    this.chatService.getMessages(this.UniqueId);
  }

  ngOnDestroy() {
    this.messages.unsubscribe();
    this.message.unsubscribe();
    this.chatService.NullAllSubs();
  }

  public async SendMessage() {
    const textelement = document.getElementById('textmessage') as HTMLInputElement;
    const msg = textelement.value.trim();
    const lowCase = msg.toLocaleLowerCase();
    textelement.value = '';
    if (msg.length === 0)
      return;
    if (msg.startsWith("/dm")) {
      $('#downloadManagerModal').modal('show');
      return;
    }
    const chatmessage: ChatMessage = {
      username: this.Username,
      message: msg.slice(0, 500),
      time: new Date(),
      color: '',
      usercolor: ''
    }
    this.chatService.sendMessage(chatmessage, this.UniqueId);
  }

  public ClearChat() {
    this.chatService.clearChat(this.UniqueId);
  }

  public AddSmiley(smiley: string) {
    const textelement = document.getElementById('textmessage') as HTMLInputElement;
    textelement.value += smiley;
  }

}
