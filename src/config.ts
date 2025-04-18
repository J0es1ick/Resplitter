import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

export const config = {
  telegram: {
    token: process.env.TELEGRAM_TOKEN as string,
    webAppUrl: process.env.WEB_APP_URL || ''
  },
  receiptProcessor: {
    api: process.env.RECEIPT_PROCESSOR_API as string,
    uploadEndpoint: `${process.env.RECEIPT_PROCESSOR_API}/upload`,
    resultEndpoint: `${process.env.RECEIPT_PROCESSOR_API}/result`,
    apiKey: process.env.API_KEY as string,
    folderId: process.env.API_FOLDER_KEY as string
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    isProduction: process.env.NODE_ENV === 'production'
  }
} as const;
