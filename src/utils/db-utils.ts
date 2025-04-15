import { DataSource } from 'typeorm';
import { User } from '../models/user';
import { config } from '../config';

export const connection = new DataSource({
  type: 'postgres',
  host: config.database.host,
  port: config.database.port,
  username: config.database.username,
  password: config.database.password,
  database: config.database.database,
  entities: [User],
  synchronize: true
});
