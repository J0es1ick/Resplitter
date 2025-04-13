import dotenv from 'dotenv';

dotenv.config();

export const API_UPLOAD_ENDPOINT = process.env.API_UPLOAD_ENDPOINT;
export const API_RESULT_ENDPOINT = process.env.API_RESULT_ENDPOINT;
export const API_KEY = process.env.API_KEY;
export const API_FOLDER_KEY= process.env.API_FOLDER_KEY;
export const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;