export const generateBotDeepLink = (sessionId: string, botUsername: string): string =>
  `https://t.me/${botUsername}?start=receipt_${encodeURIComponent(sessionId)}`;
