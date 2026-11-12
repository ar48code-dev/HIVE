import { createAiHarness } from 'ag-studio';
import type { AgAiEvent, AgAiHarnessSetup, AgLlmAdapter, AgLlmRequest, AgLlmResponse } from 'ag-studio';
import { api } from '../api';

const adapter: AgLlmAdapter = {
  executeTurn(request: AgLlmRequest, options) {
    const complete = api<AgLlmResponse>('/api/studio/turn', {
      method: 'POST',
      body: JSON.stringify(request),
      signal: options?.signal,
    });

    const stream = (async function* (): AsyncGenerator<AgAiEvent> {
      const response = await complete;
      for (const item of response.output) {
        if (item.type === 'message' && item.kind === 'output') {
          for (const part of item.content) {
            if (part.type !== 'text' || !part.text) continue;
            yield { type: 'TEXT_MESSAGE_START', messageId: item.id, role: 'assistant' };
            yield { type: 'TEXT_MESSAGE_CONTENT', messageId: item.id, delta: part.text };
            yield { type: 'TEXT_MESSAGE_END', messageId: item.id };
          }
        } else if (item.type === 'function_call') {
          yield { type: 'TOOL_CALL_START', toolCallId: item.callId, toolCallName: item.name };
          yield { type: 'TOOL_CALL_ARGS', toolCallId: item.callId, delta: item.arguments };
          yield { type: 'TOOL_CALL_END', toolCallId: item.callId };
        }
      }
    })();

    return { stream, complete };
  },
};

export const hiveStudioAi: AgAiHarnessSetup = ({ api: studioApi }) => createAiHarness(studioApi, {
  adapter,
  primary: 'lead',
  models: [{ id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash · Vertex AI' }],
  promptStarters: [
    {
      label: 'Explain the risk signals',
      prompt: 'On the Risk and alerts page, explain the highest-scoring alerts using only the loaded HIVE fields and evidence.',
    },
    {
      label: 'Compare payments and refunds',
      prompt: 'Create a clear chart comparing daily payments and refunds from the loaded transaction data. State that these are demo records.',
    },
    {
      label: 'Describe this report',
      prompt: 'What data sources, fields, and limitations are available in this HIVE report?',
    },
  ],
});
