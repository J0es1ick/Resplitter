import type { ParsedReceipt } from './parsed-receipt';

export interface ParticipantSelection {
  userId: number;
  displayName: string;
  itemIds: string[];
  itemQuantities?: Record<string, number>;
  updatedAt: string;
}

export interface ReceiptSession {
  id: string;
  ownerUserId: number;
  sourceChatId: number;
  receipt: ParsedReceipt;
  participants: Record<string, ParticipantSelection>;
  version: number;
  status: 'draft' | 'open' | 'finalized';
  splitMode: 'items' | 'equal';
  inviteToken?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}
