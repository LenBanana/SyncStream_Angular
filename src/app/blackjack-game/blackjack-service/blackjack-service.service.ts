import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ChatMessage } from 'src/app/Interfaces/Chatmessage';
import { BlackjackDealer, BlackjackMember } from 'src/app/Interfaces/Games/blackjack';
import { hubConnection, SignalRService } from 'src/app/services/signal-r.service';

@Injectable({
  providedIn: 'root'
})
export class BlackjackService {

  askPullUpdate: BehaviorSubject<boolean> = new BehaviorSubject(null);
  askBetUpdate: BehaviorSubject<boolean> = new BehaviorSubject(null);
  dealerUpdate: BehaviorSubject<BlackjackDealer> = new BehaviorSubject(null);
  selfUpdate: BehaviorSubject<BlackjackMember> = new BehaviorSubject(null);
  membersUpdate: BehaviorSubject<BlackjackMember[]> = new BehaviorSubject(null);
  constructor(private signalRService: SignalRService) {
    signalRService.connectionClosed.subscribe(isClosed => {
      if (isClosed===false) {
        this.addAskBetListener();
        this.addAskPullListener();
        this.addBlackjackDealerListener();
        this.addBlackjackMemberListener();
        this.addBlackjackSelfListener();
      }
      if (isClosed===true) {
        this.removeAskBetListener();
        this.removeAskPullListener();
        this.removeBlackjackDealerListener();
        this.removeBlackjackMemberListener();
        this.removeBlackjackSelfListener();
      }
    });
   }
   

  public addAskBetListener() {
    hubConnection.on('askforbet', (data) => {
      this.askBetUpdate.next(true);
    })
  }

  public removeAskBetListener() {
    hubConnection.off('askforbet');
    this.askBetUpdate.next(null);
  }

  public addAskPullListener() {
    hubConnection.on('askforpull', (data) => {
      this.askPullUpdate.next(data);
    })
  }

  public removeAskPullListener() {
    hubConnection.off('askforpull');
    this.askPullUpdate.next(null);
  }

  public addBlackjackSelfListener() {
    hubConnection.on('sendblackjackself', (data) => {
      this.selfUpdate.next(data);
    })
  }

  public removeBlackjackSelfListener() {
    hubConnection.off('sendblackjackself');
    this.selfUpdate.next(null);
  }

  public addBlackjackMemberListener() {
    hubConnection.on('sendblackjackmembers', (data) => {
      this.membersUpdate.next(data);
    })
  }

  public removeBlackjackMemberListener() {
    hubConnection.off('sendblackjackmembers');
    this.membersUpdate.next(null);
  }

  public addBlackjackDealerListener() {
    hubConnection.on('sendblackjackdealer', (data) => {
      this.dealerUpdate.next(data);
    })
  }

  public removeBlackjackDealerListener() {
    hubConnection.off('sendblackjackdealer');
    this.dealerUpdate.next(null);
  }

  public setBet(UniqueId: string, bet: number) {
    hubConnection.invoke('SetBet', UniqueId, bet);
  }  

  public pull(UniqueId: string, pull: boolean, doubleOption: boolean) {
    hubConnection.invoke('TakePull', UniqueId, pull, doubleOption);
  }
}

