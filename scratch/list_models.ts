import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: '.env.local' });

async function listModels() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('Error: GEMINI_API_KEY not found in .env.local');
    return;
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    // There is no direct listModels in the SDK but we can try to fetch the models 
    // manually or use a known model to see if it works.
    // Actually the SDK doesn't expose listModels. We have to use the REST API.
    
    console.log('Attempting to detect available models via REST...');
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const data = await response.json();
    
    if (data.error) {
      console.error('API Error:', data.error);
      return;
    }

    console.log('\nAvailable Models:');
    data.models.forEach((m: any) => {
      console.log(`- ${m.name} (Methods: ${m.supportedGenerationMethods.join(', ')})`);
    });

  } catch (error) {
    console.error('Failed to list models:', error);
  }
}

listModels();
