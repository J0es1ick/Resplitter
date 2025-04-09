import { DataSource } from 'typeorm';

const connection = new DataSource({
  type: 'postgres',
  host: 'localhost',
  port: 5000,
  username: 'test',
  password: 'test',
  database: 'test'
});
