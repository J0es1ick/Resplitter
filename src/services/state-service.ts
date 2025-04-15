import { ChatState } from '../interfaces';

const chatStates: Record<number, ChatState> = {};

export function getChatState(chatId: number): ChatState {
  if (!chatStates[chatId]) {
    chatStates[chatId] = {};
  }
  return chatStates[chatId];
}

export function updateChatState(chatId: number, newState: Partial<ChatState>) {
  chatStates[chatId] = { ...getChatState(chatId), ...newState };
}
