import 'reflect-metadata';

import { commands } from './constants/commands';
import { bot } from './bot/bot';
import { setupTextHandler } from './handlers/text-handler';
import { setupPhotoHandler } from './handlers/photo-handler';
import { setupCallbackHandler } from './handlers/callback-handler';

const start = async () => {
  bot.setMyCommands(commands);

  setupTextHandler();
  setupPhotoHandler();
  setupCallbackHandler();
};

start();
