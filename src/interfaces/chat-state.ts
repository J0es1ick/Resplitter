export type FlowKind = 'newItem' | 'editItem' | 'changeTotal' | 'peopleCount';

export interface UserFlow {
  sessionId: string;
  waitingFor: FlowKind;
  editingItemId?: string;
  selectionOnly?: boolean;
  expectedVersion?: number;
  promptMessageId?: number;
  promptMessageIds?: number[];
  updatedAt: string;
}
