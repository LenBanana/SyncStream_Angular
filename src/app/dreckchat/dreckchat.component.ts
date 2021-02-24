import { Component, OnInit, Input } from '@angular/core';
import { DreckchatService } from './dreckchat-service/dreckchat.service';
import { ChatMessage } from '../Interfaces/Chatmessage';
import $ from 'jquery';

@Component({
  selector: 'app-dreckchat',
  templateUrl: './dreckchat.component.html',
  styleUrls: ['./dreckchat.component.scss']
})
export class DreckchatComponent implements OnInit {

  constructor(public chatService: DreckchatService) { }

  @Input() UniqueId: string;
  @Input() Username: string;
  @Input() nav: boolean;
  Messages: ChatMessage[];
  CurrentDate: Date = new Date();
  smileys: string[] = ('😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 😘 😗 😙 😚 😋 😜 😝 😛 🤑 🤗 🤓 😎 🤡 🤠 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 😤 😠 😡 😶 😐 😑 😯 😦 😧 😮 😲 😵 😳 😱 😨 😰 😢 😥 🤤 😭 😓 😪 😴 🙄 🤔 🤥 😬 🤐 🤢 🤮 🤧 😷 🤒 🤕 🤨 🤩 🤯 🧐 🤫 🤪 🤭').split(' ');
  showSmileys: boolean = false;

  ngOnInit(): void {    
    this.chatService.addMessageListener();
    this.chatService.messages.subscribe(result => {
      this.Messages = result;
      setTimeout(() => $('#messagebox').scrollTop($('#messagebox')[0].scrollHeight), 100);
    });
    this.chatService.HttpGetMessages(this.UniqueId);
  }

  public async SendMessage() {
    const textelement = document.getElementById('textmessage') as HTMLInputElement;
    if (textelement.value.length === 0)
      return;
    const chatmessage: ChatMessage = { username: this.Username, message: textelement.value, time: new Date() }
    this.chatService.sendMessage(chatmessage, this.UniqueId);
    textelement.value = '';
  }

  public AddSmiley(smiley: string) {
    const textelement = document.getElementById('textmessage') as HTMLInputElement;
    textelement.value += smiley;
  }

}
