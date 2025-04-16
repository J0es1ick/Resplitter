import { ParsedReceipt } from './parsed-receipt';

export interface ChatState {
  receipt?: ParsedReceipt;
  editingItemIndex?: number;
  waitingFor?: 'peopleCount' | 'newItem' | 'editItem' | 'removeItem' | 'changeTotal';
}
