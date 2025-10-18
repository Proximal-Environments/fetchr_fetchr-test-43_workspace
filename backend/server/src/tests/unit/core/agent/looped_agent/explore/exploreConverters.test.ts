// import { describe, it, expect } from 'vitest';
// import {
//   convertExploreMessagesToFetchrMessages,
//   convertFetchrMessagesToExploreMessages,
// } from '../../../../../../fetchr/core/agent/looped_agent/explore/exploreConverters';
// import { FetchrMessage } from '../../../../../../fetchr/core/chat/chatHistory';

// const sampleFetchrChatHistory: FetchrMessage[] = [
//   {
//     role: 'user',
//     content: 'Hello, this is a test message',
//   },
//   {
//     role: 'assistant',
//     content: 'This is a response',
//   },
//   {
//     role: 'user',
//     content: [
//       {
//         type: 'text',
//         text: 'Hello, this is a test message',
//       },
//       {
//         type: 'image',
//         imageUrl: 'https://example.com/image.jpg',
//       },
//     ],
//   },
//   {
//     role: 'user',
//     content: [
//       ToolUsageRequest.createFromPayload(
//         new SuggestProductsToUserRequestPayload({
//           searchQueries: [
//             {
//               query: 'Hello, this is a test message',
//               explanation: 'This is a test message',
//             },
//           ],
//         }),
//         '1',
//       ),
//     ],
//   },
//   {
//     role: 'assistant',
//     content: [
//       ToolUsageResponse.createFromPayload(
//         new SuggestProductsToUserResponsePayload({
//           productPreferences: [
//             {
//               product: {
//                 id: '1',
//                 title: 'Product 1',
//                 name: 'Product 1',
//                 imageUrls: ['https://example.com/image.jpg'],
//                 brandId: '1-2',
//                 brandName: 'Brand 1',
//                 url: 'https://example.com/product.jpg',
//                 s3ImageUrls: ['https://example.com/image-s3.jpg'],
//                 description: 'This is a test message',
//                 fullGeneratedDescription: 'This is a test message',
//                 price: 100,
//                 gender: Gender.GENDER_MALE,
//                 sizes: [],
//                 category: ProductCategory.PRODUCT_CATEGORY_ACCESSORIES,
//                 colors: [],
//                 materials: [],
//                 style: 'Style',
//                 compressedImageUrls: [],
//                 isKidProduct: false,
//                 scrapingMetadata: undefined,
//                 highresWebpUrls: ['https://example.com/image-highres.jpg'],
//               },
//               preferenceItem: {
//                 comments: 'This is a test message',
//                 preferenceType: PreferenceType.LIKE,
//                 itemId: '1',
//               },
//             },
//           ],
//         }),
//         '1',
//       ),
//     ],
//   },
// ];

// describe('exploreConverters', () => {
//   describe('convertFetchrMessageToExploreMessage', () => {
//     it('double conversion should return the same chat history', async () => {
//       const exploreMessage = convertFetchrMessagesToExploreMessages(sampleFetchrChatHistory);
//       const fetchrMessagesAgain = await convertExploreMessagesToFetchrMessages(exploreMessage);
//       expect(fetchrMessagesAgain).toEqual(sampleFetchrChatHistory);
//     });
//   });
// });
