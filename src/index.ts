import 'reflect-metadata';

import { commands } from './constants/commands';
import { bot } from './bot/bot';
import { connection } from './utils';
import { setupTextHandler } from './handlers/text-handler';
import { setupPhotoHandler } from './handlers/photo-handler';
import { setupCallbackHandler } from './handlers/callback-handler';

const start = async () => {
  bot.setMyCommands(commands);

  connection.initialize().catch((error) => console.log(error));

  setupTextHandler();
  setupPhotoHandler();
  setupCallbackHandler();
};

start();
