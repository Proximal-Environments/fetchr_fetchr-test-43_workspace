import { openAIService, productService } from '../../src/fetchr/base/service_injection/global';
import { FetchrContentBlock, TemporaryChatHistory } from '../../src/fetchr/core/chat/chatHistory';
import { OpenAIModel } from '@fetchr/schema/core/core';
import { z } from 'zod';

const product = await productService.getProductOrFail('600c964e-79c8-3537-8675-872e7135e91d');

const chatHistory = new TemporaryChatHistory();

await chatHistory.addMessage({
  role: 'system',
  content: `Please create a generated description with all information about both the product details and the style for this specific product. Include all specific things a user could search for like small details as well. Do not be salesy, we just want the specifications (for both product and the style)
Also give me 5 queries to search for and find this product.`,
});

chatHistory.addMessage({
  role: 'user',
  content: [
    {
      type: 'text',
      text: `Here is the product:
# ${product.title}
## Brand: ${product.subBrandName ?? product.brandName}
Original description from the brand: ${product.description}
`,
    },
    ...product.compressedImageUrls.slice(0, 5).map(
      url =>
        ({
          type: 'image',
          imageUrl: url,
        } as FetchrContentBlock),
    ),
  ],
});

const { generatedDescription, queries } = await openAIService.submitChatCompletion(
  await chatHistory.getOpenAiMessages(),
  {
    model: OpenAIModel.GPT_4_1_MINI,
    zodSchema: z.object({
      generatedDescription: z.string(),
      queries: z.array(z.string()),
    }),
  },
);

console.log(generatedDescription);
console.log(queries);
