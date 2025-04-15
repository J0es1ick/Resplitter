import { User } from '../models/user';
import { connection } from './db-utils';

export const getUser = async (chat_id: number, tg_id: number) => {
  const userRepository = connection.getRepository(User);
  let user = await userRepository.findOneBy({ tgId: tg_id });

  if (!user) {
    user = new User();
    user.chatId = chat_id;
    user.tgId = tg_id;
    user.state = 1;
    await userRepository.save(user);
  } else if (user.chatId !== chat_id) {
    user.chatId = chat_id;
    await userRepository.save(user);
  }

  return user;
};
