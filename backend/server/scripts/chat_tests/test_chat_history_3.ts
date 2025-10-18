// import { anthropicService } from '../../src/fetchr/base/service_injection/global';
// import { MessageUserTool } from '../../src/fetchr/core/chat/tools/explore/message_user_tool';

import { PersistedChatHistory } from '../../src/fetchr/core/chat/chatHistory';
import { openAIService } from '../../src/fetchr/base/service_injection/global';
import {
  MessageUserResponsePayload,
  MessageUserTool,
} from '../../src/fetchr/core/chat/tools/explore/message_user_tool';
import { randomUUID } from 'node:crypto';

const response = await openAIService.submitChatCompletion(
  [
    {
      role: 'user',
      content: 'Can you tell me hi?',
    },
  ],
  {
    tools: [MessageUserTool.functionSchema],
  },
);

console.log('[Response]', JSON.stringify(response, null, 2));

const functionCall = response.choices[0].message.tool_calls?.[0] ?? undefined;

if (functionCall) {
  const functionCallData = JSON.parse(functionCall.function.arguments);
  const id = randomUUID();
  const chatHistory = new PersistedChatHistory(id);
  await chatHistory.init();
  await chatHistory.addMessage({
    role: 'user',
    content: 'Can you tell me hi?',
  });
  await chatHistory.addToolRequestFromToolUseBlock({
    id,
    name: 'message_user',
    input: functionCallData,
    type: 'tool_use',
  });
  await chatHistory.addToolResult(
    new MessageUserResponsePayload({
      message: 'Hello',
    }),
    id,
  );

  await chatHistory.addMessage({
    role: 'user',
    content: 'say hi again',
  });

  const openAIMessages = await chatHistory.getOpenAiMessages();
  console.log('[OpenAI Messages]', JSON.stringify(openAIMessages, null, 2));

  const response = await openAIService.submitChatCompletion(openAIMessages, {
    tools: [MessageUserTool.functionSchema],
  });
  console.log('[Response]', JSON.stringify(response, null, 2));
}
// await chatHistory.init();
// console.log(JSON.stringify(chatHistory.toJson(), null, 2));
