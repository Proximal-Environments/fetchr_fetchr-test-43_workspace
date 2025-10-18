import * as dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env file
dotenv.config({ path: resolve(__dirname, '../../.env') });

import { anthropicService } from '../../src/fetchr/base/service_injection/global';
import { logService } from '../../src/fetchr/base/logging/logService';
import { AnthropicModel } from '../../src/proto/core/core';

async function testAnthropicService(): Promise<void> {
  try {
    // Test 1: Simple completion without tool calling
    const simpleResponse = await anthropicService.submitChatCompletion(
      'What is the capital of France?',
      {
        model: AnthropicModel.CLAUDE_3_5_SONNET_LATEST,
        temperature: 0.7,
      },
    );

    logService.info('Simple completion response:', {
      metadata: {
        content: simpleResponse.content,
        role: simpleResponse.role,
      },
    });

    // Test 2: Completion with tool calling
    const toolResponse = await anthropicService.submitChatCompletion(
      [{ role: 'user', content: 'What is 2 + 2?' }],
      {
        model: AnthropicModel.CLAUDE_3_5_SONNET_LATEST,
        temperature: 0.7,
        functions: [
          {
            name: 'calculate',
            description: 'Calculate a mathematical expression',
            // @ts-expect-error - old code
            parameters: {
              type: 'object',
              properties: {
                expression: {
                  type: 'string',
                  description: 'The mathematical expression to calculate',
                },
              },
              required: ['expression'],
            },
          },
        ],
      },
    );
    logService.info('Tool calling response:', {
      metadata: {
        content: toolResponse.content,
        role: toolResponse.role,
      },
    });
  } catch (error) {
    logService.error('Error testing Anthropic service:', { error });
    throw error;
  }
}

// Run the tests
testAnthropicService().catch(console.error);
