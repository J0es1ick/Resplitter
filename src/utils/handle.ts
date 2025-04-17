import axios from 'axios';
import fs from 'fs';


function jsonParser(data: JSON){

}

export async function sendToReceiptProcessor(
  imagePath: string,
  API_UPLOAD_ENDPOINT: string,
  API_RESULT_ENDPOINT: string,
  API_KEY: string,
  API_FOLDER_KEY:string
): Promise<string> {

  try {
    const image = fs.readFileSync(imagePath);
    const encoded = Buffer.from(image).toString('base64');

    const response = await axios.post(API_UPLOAD_ENDPOINT, 
      {
        mimeType: "jpeg",
        languageCodes: ["ru", "en"],
        content: encoded
      },
       {
      headers: {"Content-Type": "application/json",
          "Authorization": `Bearer ${API_KEY}`,
          "x-folder-id": `${API_FOLDER_KEY}`,
          "x-data-logging-enabled": "true"}
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
