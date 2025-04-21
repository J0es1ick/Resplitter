import { ParsedReceipt } from '.';

export interface UserState {
  receipt?: ParsedReceipt;
  groupChatId?: number;
}
