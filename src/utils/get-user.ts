import { User } from '../models/User';
import { connection } from './db';

export const getUser = async (chat_id: number, tg_id: number) => {
  const userRepository = connection.getRepository(User);
  let user = await userRepository.findOneBy({
    chatId: chat_id,
    tgId: tg_id
  });

  if (!user) {
    user = new User();
    user.chatId = chat_id;
    user.tgId = tg_id;
    user.state = 1;
    await connection.manager.save(user);
  }

  return user;
};
