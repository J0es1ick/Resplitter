import { bot } from './bot';
import { stateService } from '../services/state-service';
import { BotScreenService } from '../services/bot-screen-service';

export const screens = new BotScreenService(bot, stateService);
