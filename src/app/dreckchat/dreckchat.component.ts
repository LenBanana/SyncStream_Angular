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
import $ from 'jquery';
import { Language } from '../Interfaces/Language';

@Component({
  selector: 'app-dreckchat',
  templateUrl: './dreckchat.component.html',
  styleUrls: ['./dreckchat.component.scss']
})
export class DreckchatComponent implements OnInit, OnDestroy {

  constructor(public chatService: DreckchatService) {}

  @Input() UniqueId: string;
  @Input() Username: string;
  @Input() nav: boolean;
  @Input() logout: boolean;
  @Input() WhiteBoard: boolean;
  @Output() NewMessage = new EventEmitter();
  Messages: ChatMessage[] = [];
  CurrentDate: Date = new Date();
  smileys: string[] = ('😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 😘 😗 😙 😚 😋 😜 😝 😛 🤑 🤗 🤓 😎 🤡 🤠 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 😤 😠 😡 😶 😐 😑 😯 😦 😧 😮 😲 😵 😳 😱 😨 😰 😢 😥 🤤 😭 😓 😪 😴 🙄 🤔 🤥 😬 🤐 🤢 🤮 🤧 😷 🤒 🤕 🤨 🤩 🤯 🧐 🤫 🤪 🤭').split(' ');
  showSmileys: boolean = false;
  messages: any;
  message: any;

  ngOnInit(): void {
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
  }

  public async SendMessage() {
    const textelement = document.getElementById('textmessage') as HTMLInputElement;
    const msg = textelement.value.trim();
    const lowCase = msg.toLocaleLowerCase();
    textelement.value = '';
    if (msg.length === 0)
      return;

    if (lowCase.startsWith('/')) {
      if (lowCase == '/clear' || lowCase == '/c') {
        if (this.logout) {
          this.ClearChat();
        }
      }
      if ((lowCase.startsWith('/playgallows') || lowCase.startsWith('/playgallow') || lowCase.startsWith('/gallows') || lowCase.startsWith('/gallow') || lowCase.startsWith('/galgenraten') || lowCase.startsWith('/galgen') || lowCase.startsWith('/g'))) {
        var lang = lowCase.split(' ')[1]
        var gameTimeString = lowCase.split(' ')[2]
        var gameLanguage = Language.German;
        var gameTime = 90;
        if (lang) {
          lang = lang.trim();
          if (lang.startsWith("e")) {
            gameLanguage = Language.English;
          }
        }
        var langAsTime = Number.parseInt(lang);
        if (!isNaN(langAsTime)) {
          gameTime = langAsTime;
        }
        if (gameTimeString&&gameTime==90) {
          gameTimeString = gameTimeString.trim();
          gameTime = Number.parseInt(gameTimeString);
          if (isNaN(gameTime)) {
            gameTime = 90;
          }
        }
        this.chatService.playGallows(this.UniqueId, gameLanguage, gameTime);        
      }
      if ((lowCase.startsWith('/playblackjack') || lowCase.startsWith('/playbj') || lowCase.startsWith('/blackjack') || lowCase.startsWith('/bj') || lowCase.startsWith('/b'))) {
        this.chatService.playBlackjack(this.UniqueId);
      }
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
