import { TemporaryChatHistory } from '../../src/fetchr/core/chat/chatHistory';

import {
  anthropicService,
  productService,
  s3Service,
} from '../../src/fetchr/base/service_injection/global';

const chatHistory = new TemporaryChatHistory();
const sampleProduct = await productService.getSampleProduct();

await chatHistory.addMessage({
  role: 'user',
  content: [
    {
      type: 'image',
      image: await s3Service.getImageSafeOrFail(sampleProduct.compressedImageUrls[0]),
      caption: 'Product Image #1',
    },
  ],
});

const newChatHistory = await chatHistory.cloneIntoTemporaryChatHistory();
console.log('[newChatHistory]', await newChatHistory.getAnthropicMessages());

const anthropicResponse = await anthropicService.submitChatCompletion(
  await newChatHistory.getAnthropicMessages(),
);

console.log(anthropicResponse);
