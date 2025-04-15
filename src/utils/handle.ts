import axios from 'axios';
import fs from 'fs';

export const sendToReceiptProcessor = async (
  imagePath: string,
  messageId: string,
  API_UPLOAD_ENDPOINT: string,
  API_RESULT_ENDPOINT: string
) => {
  try {
    const image = fs.readFileSync(imagePath);

    const formData = new FormData();
    const blob = new Blob([image], { type: 'image/jpeg' });
    formData.append('image', blob, `receipt_${messageId}.jpg`);

    const response = await axios.post(API_UPLOAD_ENDPOINT, formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });

    const processingId = response.data.id;

    let result;
    let attempts = 0;
    const maxAttempts = 10;
    const delay = 2000;

    while (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      const resultResponse = await axios.get(`${API_RESULT_ENDPOINT}/${processingId}`);

      if (resultResponse.data.status === 'completed') {
        result = resultResponse.data.text;
        break;
      }

      attempts++;
    }

    if (!result) throw new Error('Превышено время ожидания обработки чека');

    return result;
  } catch (error) {
    console.error('Ошибка при обработке чека:', error);
    throw error;
  }
};
