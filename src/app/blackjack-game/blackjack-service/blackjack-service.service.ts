import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { BlackjackDealer, BlackjackMember } from '../../Interfaces/Games/blackjack';
import { hubConnection, SignalRService } from '../../services/signal-r.service';

@Injectable({
  providedIn: 'root'
})
export class BlackjackService {

  askPullUpdate: BehaviorSubject<boolean> = new BehaviorSubject(null);
  askSplitPullUpdate: BehaviorSubject<boolean> = new BehaviorSubject(null);
  askBetUpdate: BehaviorSubject<boolean> = new BehaviorSubject(null);
  dealerUpdate: BehaviorSubject<BlackjackDealer> = new BehaviorSubject(null);
  selfUpdate: BehaviorSubject<BlackjackMember> = new BehaviorSubject(null);
  membersUpdate: BehaviorSubject<BlackjackMember[]> = new BehaviorSubject(null);
  constructor(private signalRService: SignalRService) {
    signalRService.connectionClosed.subscribe(isClosed => {
      if (isClosed===false) {
        this.addAskBetListener();
        this.addAskPullListener();
        this.addAskSplitPullListener();
        this.addBlackjackDealerListener();
        this.addBlackjackMemberListener();
        this.addBlackjackSelfListener();
      }
      if (isClosed===true) {
        this.removeAskBetListener();
        this.removeAskPullListener();
        this.removeAskSplitPullListener();
        this.removeBlackjackDealerListener();
        this.removeBlackjackMemberListener();
        this.removeBlackjackSelfListener();
      }
    });
   }

  public pushAllNull() {
    this.askBetUpdate.next(null);
    this.askPullUpdate.next(null);
    this.askSplitPullUpdate.next(null);
    this.selfUpdate.next(null);
    this.membersUpdate.next(null);
    this.dealerUpdate.next(null);
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

  public addAskSplitPullListener() {
    hubConnection.on('askforsplitpull', (data) => {
      this.askSplitPullUpdate.next(data);
    })
  }

  public removeAskSplitPullListener() {
    hubConnection.off('askforsplitpull');
    this.askSplitPullUpdate.next(null);
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

  public pull(UniqueId: string, pull: boolean, doubleOption: boolean, splitOption: boolean) {
    hubConnection.invoke('TakePull', UniqueId, pull, doubleOption, splitOption);
  }

  public splitpull(UniqueId: string, pull: boolean, pullForSplitHand: boolean) {
    hubConnection.invoke('TakeSplitPull', UniqueId, pull, pullForSplitHand);
  }
}

