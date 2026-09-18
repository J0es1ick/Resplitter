interface TelegramWebApp {
  initData: string;
  ready(): void;
  expand(): void;
  close(): void;
  colorScheme?: 'dark' | 'light';
  enableClosingConfirmation(): void;
  disableClosingConfirmation(): void;
  openTelegramLink(url: string): void;
  onEvent(event: string, handler: () => void): void;
  offEvent(event: string, handler: () => void): void;
  HapticFeedback?: { selectionChanged(): void; notificationOccurred(type: 'success' | 'error'): void };
}
declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}
export const telegram = window.Telegram?.WebApp.initData ? window.Telegram.WebApp : undefined;
