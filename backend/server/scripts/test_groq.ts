import { groqService } from '../src/fetchr/base/service_injection/global';
import { MessageUserTool } from '../src/fetchr/core/chat/tools/explore/message_user_tool';

const result = await groqService.submitChatCompletion(
  [
    {
      role: 'user',
      content: 'Tell hi to the user',
    },
  ],
  {
    tools: [MessageUserTool.functionSchema],
  },
);

console.log(JSON.stringify(result, null, 2));
