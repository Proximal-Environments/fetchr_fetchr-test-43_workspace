import { openAIService } from '../../src/fetchr/base/service_injection/global';
import { OpenAIModel } from '@fetchr/schema/core/core';
import { z } from 'zod';

(async (): Promise<void> => {
  try {
    // Test 1: Basic chat completion
    console.log('Testing basic chat completion...');
    const response = await openAIService.submitChatCompletion('Hello from Devin!', {
      model: OpenAIModel.GPT_4O,
      temperature: 0.7,
    });
    console.log('Basic chat response:', JSON.stringify(response, null, 2));

    // Test 2: Function calling
    console.log('\nTesting function calling...');
    const functionResponse = await openAIService.submitChatCompletion(
      'Convert 5 kilometers to miles',
      {
        model: OpenAIModel.GPT_4O,
        temperature: 0.7,
        tools: [
          {
            name: 'convert_distance',
            description: 'Convert between different units of distance',
            input: z.object({
              from_value: z.number(),
              from_unit: z.string(),
              to_unit: z.string(),
            }),
          },
        ],
      },
    );
    console.log('Function call response:', JSON.stringify(functionResponse, null, 2));

    // Test 3: Zod schema structured output
    console.log('\nTesting Zod schema output...');
    const colorSchema = z.object({
      name: z.string().describe('The name of the color'),
      hex: z.string().describe('The hex code of the color'),
      rgb: z
        .object({
          r: z.number().describe('Red value (0-255)'),
          g: z.number().describe('Green value (0-255)'),
          b: z.number().describe('Blue value (0-255)'),
        })
        .describe('RGB values of the color'),
    });

    const schemaResponse = await openAIService.submitChatCompletion(
      'Give me the color information for forest green',
      {
        model: OpenAIModel.GPT_4O,
        temperature: 0.7,
        zodSchema: colorSchema,
      },
    );
    console.log('Schema response:', JSON.stringify(schemaResponse, null, 2));
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
