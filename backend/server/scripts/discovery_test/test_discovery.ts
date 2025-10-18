import { OpenAIModel } from '@fetchr/schema/core/core';
import { openAIService, userService } from '../../src/fetchr/base/service_injection/global';
import { TemporaryChatHistory } from '../../src/fetchr/core/chat/chatHistory';
import { z } from 'zod';

const user = await userService.getProfileByEmailOrFail('navidkpour@gmail.com');
// const user = await userService.getProfileByEmailOrFail('calvin@fetchr.so');
const bio = user.generatedProfileDescription?.description;

if (!bio) {
  throw new Error('No bio found');
}

const chatHistory = new TemporaryChatHistory();

chatHistory.addMessage({
  role: 'system',
  content: `You are a fashion recommendation agent. You are given a user's bio and you need to recommend a set of items to show to the user.
These items should:
- Be relevant to the user's bio
- Be appropriate for the user's lifestyle
- Compliment the user's existing wardrobe (do not recommend items that are too similar to what they already have)
- Also take into account the user's measurements. What will look good on them?

Also, you should recommend items that are complementary to the user's bio (but not mentioned in the bio). Be a fashion expert and recommend items that are complementary to the user's existing bio.

Explain the product in details (ie: explain the product itself, not the brand, the ocassion etc).

Use maximum 10 words to explain the product.

Do not recomment shoes or accessories.


Generate at least 5 items and 5 complementary items.
`,
});

// const orders = await orderManagementService.getOrdersByCustomerId(user.id);

chatHistory.addMessage({
  role: 'user',
  content: `Here is the my bio: ${bio}\nI am 5'10" and 170lbs`,
});

chatHistory.addMessage({
  role: 'user',
  content: `\
Some of my feedback on previous queries:
Taupe layered long-sleeve tee with minimal side seams. -> I don't like it
Dark forest cargo pants featuring sleek flat utility pockets. -> I don't like cargo pants, my legs are already too big for them and they are not stretchy
Muted mauve sweatshirt with understated drop-shoulder silhouette. -> Not bad
Lightweight burgundy zip hoodie featuring subtle tonal stitching. -> I usually don't like zip hoodies that are flimsy and thin
Lightly distressed black denim jacket with relaxed silhouette. -> Already have one
`,
});

const { items, complementaryItems } = await openAIService.submitChatCompletion(
  await chatHistory.getOpenAiMessages(),
  {
    model: OpenAIModel.O1,
    zodSchema: z.object({
      items: z.array(z.string()),
      complementaryItems: z.array(z.string()),
    }),
  },
);

console.log(items);
console.log(complementaryItems);

// const queryProducts = await Promise.all(
//   [...items, ...complementaryItems].map(async item => {
//     const products = await productSearchService.searchProducts({
//       query: item,
//       brandIds: [],
//       productIdWhitelist: [],
//       productIdBlacklist: [],
//       gender: user.metadata?.gender ?? undefined,
//     });

//     const rerankedProducts = await productSearchService.rerankProductsUsingQueryBio(
//       products.slice(0, 20),
//       item,
//       user.generatedProfileDescription?.description ?? '',
//     );

//     return { query: item, rankedProducts: rerankedProducts };
//   }),
// );

// queryProducts.forEach(item => {
//   console.log('Query:', item.query);
//   item.rankedProducts.forEach(product => {
//     if (product.product?.compressedImageUrls?.[0]) {
//       console.log('Image URL:', product.product.compressedImageUrls[0]);
//     }
//   });
// });

// const productImageUrls = productsPerItem.map(itemProducts =>
//   itemProducts.products.map(product => product.product?.s3ImageUrls),
// );

// productsPerItem.forEach(({ item, products }) => {
//   console.log('Query:', item);
//   products.forEach(product => {
//     console.log('URLs:', product.product?.s3ImageUrls[0]);
//   });
// });
