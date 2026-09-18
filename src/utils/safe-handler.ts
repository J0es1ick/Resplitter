import { logger } from './logger';

export const safeAsyncHandler =
  <Arguments extends unknown[]>(name: string, handler: (...arguments_: Arguments) => Promise<void>): ((...arguments_: Arguments) => void) =>
  (...arguments_: Arguments): void => {
    void handler(...arguments_).catch((error) => logger.error('Async event handler failed', { handler: name, error }));
  };
