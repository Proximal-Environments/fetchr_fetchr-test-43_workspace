// import { assertNever } from '../../src/fetchr/core/agent/looped_agent/MessageConverters';
// import { ToolUsageRequest, ToolUsageRequestType } from '../../src/fetchr/core/chat/types';

import { PersistedChatHistory } from '../../src/fetchr/core/chat/chatHistory';
import { SuggestProductsToUserResponsePayload } from '../../src/fetchr/core/chat/tools/explore/suggest_products_to_user_tool';

// const suggestProductsToSearchToolUsageRequest: ToolUsageRequestType =
//   await ToolUsageRequest.createFromToolUseBlock({
//     id: '1',
//     input: {},
//     type: 'tool_use',
//     name: 'message_user',
//   });

// suggestProductsToSearchToolUsageRequest.payload;

// const sample1ToolUsageRequest: Array<ToolUsageRequestType> = [
//   suggestProductsToSearchToolUsageRequest,
// ];

// const toolType = sample1ToolUsageRequest[0].fetchrLLMToolType;
// switch (toolType) {
//   case 'message_user':
//     sample1ToolUsageRequest[0].payload;
//     break;
//   case 'suggest_products_to_user':
//     sample1ToolUsageRequest[0].payload;
//     break;
//   case 'view_product_image':
//     sample1ToolUsageRequest[0].payload;
//     break;
//   default:
//     assertNever(toolType);
// }

const chatHistory = new PersistedChatHistory('b6cee3fa-0152-446b-bb38-12b99b675adc');
await chatHistory.init();
chatHistory.addMessage({
  role: 'user',
  content: 'Hello world',
});

console.log(
  '[Payload]',
  // @ts-expect-error not important in this script
  (chatHistory.messages[2].content[0].payload as SuggestProductsToUserResponsePayload)
    .productPreferences[0].product,
);
const anthropicMessages = await chatHistory.getAnthropicMessages();
console.log('[Anthropic Messages]', JSON.stringify(anthropicMessages, null, 2));
