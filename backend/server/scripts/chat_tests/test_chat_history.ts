import { randomUUID } from 'node:crypto';
import { PersistedChatHistory } from '../../src/fetchr/core/chat/chatHistory';
import {
  ViewProductImageResponsePayload,
  ViewProductImageTool,
} from '../../src/fetchr/core/chat/tools/explore/view_product_image_tool';
import { anthropicService, openAIService } from '../../src/fetchr/base/service_injection/global';
import { AnthropicModel } from '@fetchr/schema/core/core';

const toolId = 'call_mKRPFMrzRHRonu7v0ra';
const chatId = randomUUID();

const chatHistory = new PersistedChatHistory(chatId);
await chatHistory.init();

chatHistory.addMessage({
  role: 'system',
  content: 'You are a personal shopper. Find a product to purchase for the user.',
});

// ...

chatHistory.addToolRequestFromToolUseBlock({
  id: toolId,
  name: 'view_product_image',
  input: {
    product_id: '2588ae79-e9a5-4fd6-959a-3c77472055cb',
    explanation: 'I want to see how baggy the uniqlo shirt is',
  },
  type: 'tool_use',
});

await chatHistory.addToolResult(
  new ViewProductImageResponsePayload({
    imageUrl: 'https://example.com/image.jpg',
    encodedImage: 'https://example.com/image.jpg',
  }),
  toolId,
);

const openaiMessages = await chatHistory.getOpenAiMessages();
const openAiResponse = await openAIService.submitChatCompletion(openaiMessages, {
  tools: [ViewProductImageTool.functionSchema],
});
void openAiResponse;

const anthropicMessages = await chatHistory.getAnthropicMessages();
const anthropicResponse = await anthropicService.submitChatCompletion(anthropicMessages, {
  model: AnthropicModel.CLAUDE_3_5_SONNET_LATEST,
  functions: [ViewProductImageTool.functionSchema],
});
void anthropicResponse;
