import { config } from '../config.js';
import { getVertexGeminiClient, vertexAIConfigured } from '@workspace/integrations-gemini-ai';

export interface LlmClient {
  readonly name: string;
  generateJson(system: string, user: string): Promise<string>;
}

export class GeminiClient implements LlmClient {
  readonly name = 'gemini';
  async generateJson(system: string, user: string): Promise<string> {
    const response = await getVertexGeminiClient().models.generateContent({
      model: config.GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: user }] }],
      config: {
        systemInstruction: system,
        responseMimeType: 'application/json',
        temperature: 0.2,
        maxOutputTokens: 8192,
      },
    });
    const text = response.text ?? '';
    if (!text) throw new Error('Gemini returned no text');
    return text;
  }
}

export function defaultLlm(): LlmClient | null {
  return vertexAIConfigured() && process.env.HIVE_DISABLE_GEMINI !== 'true' ? new GeminiClient() : null;
}
