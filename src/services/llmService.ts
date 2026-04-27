import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

/**
 * Service to interact with LLMs.
 * Defaults to Gemini 1.5 Flash.
 */
export const generateAgentResponse = async (prompt: { system: string; user: string }) => {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set in environment.');
  }

  const model = genAI.getGenerativeModel({
    model: 'gemini-flash-latest',
    systemInstruction: prompt.system
  });

  const result = await model.generateContent(prompt.user);
  const response = await result.response;
  return response.text();
};

export const parseAgentOutput = (rawOutput: string) => {
  // Simple parser to extract Thinking, Actions, and Context Updates
  // In a real scenario, we might use Structured Output (JSON)
  return {
    raw: rawOutput,
    thinking: extractSection(rawOutput, 'THINKING'),
    actions: extractSection(rawOutput, 'ACTIONS'),
    contextUpdates: extractSection(rawOutput, 'CONTEXT_UPDATES'),
    status: extractSection(rawOutput, 'STATUS') || 'UNKNOWN',
  };
};

function extractSection(text: string, sectionName: string): string {
  const regex = new RegExp(`${sectionName}:?\\s*([\\s\\S]*?)(?=\\n\\d+\\.\\s|$)`, 'i');
  const match = text.match(regex);
  return match ? match[1].trim() : '';
}
