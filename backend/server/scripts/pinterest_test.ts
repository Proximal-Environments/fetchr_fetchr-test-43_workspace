// import dotenv from 'dotenv';
// import axios from 'axios';
// import { openAIService, pinterestService } from '../src/fetchr/base/service_injection/global';
// import { TemporaryChatHistory } from '../src/fetchr/core/chat/chatHistory';
// dotenv.config();

import { logService } from '../src/fetchr/base/logging/logService';
import { imagePreferenceService  } from '../src/fetchr/base/service_injection/global';

// export type GoogleImage = {
//   position: number;
//   thumbnail: string;
//   related_content_id: string;
//   serpapi_related_content_link: string;
//   source: string;
//   source_logo: string;
//   title: string;
//   link: string;
//   original: string;
//   original_width: number;
//   original_height: number;
//   is_product: boolean;
// };

// export const testPinterest = async (): Promise<GoogleImage[]> => {
//   try {
//     // SERP API configuration
//     const apiKey = process.env.SERP_API_KEY;
//     if (!apiKey) {
//       throw new Error('SERP API key not found in environment variables');
//     }

//     const query = 'black oversized jacket outfit men site:pinterest.com';
//     const url = `https://serpapi.com/search.json?engine=google_images&q=${encodeURIComponent(query)}&api_key=${apiKey}&tbs=isz:l,qdr:y`;

//     console.log(`Searching for: ${query}`);
//     const response = await axios.get(url);

//     if (!response.data || !response.data.images_results) {
//       throw new Error('No results found or invalid response format');
//     }

//     const images: GoogleImage[] = response.data.images_results;
//     console.log(`Found ${images.length} images`);

//     console.log(images);
//     const pinterestImages = images.filter(image => image.link.includes('pinterest.com'));
//     console.log(`Found ${pinterestImages.length} pinterest images`);

//     const pinterestImagesWithProduct = pinterestImages.filter(image => image.is_product);
//     console.log(`Found ${pinterestImagesWithProduct.length} pinterest images with product`);

//     // Create directory for saving images if it doesn't exist
//     // const outputDir = path.join(__dirname, '../../../data/pinterest_images');
//     // if (!fs.existsSync(outputDir)) {
//     //   fs.mkdirSync(outputDir, { recursive: true });
//     // }

//     // // Save results to JSON file
//     // const resultsPath = path.join(outputDir, 'search_results.json');
//     // fs.writeFileSync(resultsPath, JSON.stringify(images, null, 2));
//     // console.log(`Results saved to ${resultsPath}`);

//     // Download first 10 images (or fewer if less are available)
//     // const imagesToDownload = images.slice(0, 10);
//     // for (let i = 0; i < imagesToDownload.length; i++) {
//     //   const image = imagesToDownload[i];
//     //   try {
//     //     const imageResponse = await axios.get(image.original, { responseType: 'arraybuffer' });
//     //     const imagePath = path.join(outputDir, `image_${i + 1}.jpg`);
//     //     fs.writeFileSync(imagePath, imageResponse.data);
//     //     console.log(`Downloaded image ${i + 1}/${imagesToDownload.length}`);
//     //   } catch (error) {
//     //     console.error(`Failed to download image ${i + 1}: ${error.message}`);
//     //   }
//     // }

//     console.log('Pinterest image search and download completed successfully');
//     return images;
//   } catch (error) {
//     console.error('Error in Pinterest search:', error.message);
//     throw error;
//   }
// };

// const testDownloadImage = async (): Promise<Buffer> => {
//   const imageUrl = 'https://i.pinimg.com/736x/0b/44/03/0b4403ff1fbe5bc6810d534eac0f8731.jpg';
//   const image = await pinterestService.getPinterestImage(imageUrl);
//   console.log(image);

//   const chatHistory = new TemporaryChatHistory([
//     {
//       role: 'user',
//       content: [
//         {
//           type: 'image',
//           image: image,
//         },
//         {
//           type: 'text',
//           text: 'What is this image?',
//         },
//       ],
//     },
//   ]);
//   const messages = await chatHistory.getOpenAiMessages();
//   const response = await openAIService.submitChatCompletion(messages);
//   // const response = await openAIService.submitChatCompletion([
//   //   {
//   //     role: 'user',
//   //     content: [
//   //       {
//   //         type: 'image_url',
//   //         image_url: {
//   //           url: `data:image/jpeg;base64,${image.toString('base64')}`,
//   //         },
//   //       },
//   //       {
//   //         type: 'text',
//   //         text: 'What is this image?',
//   //       },
//   //     ],
//   //   },
//   // ]);
//   console.log(response.choices[0].message.content);
//   // fs.writeFileSync('image.jpg', image);
//   return image;
// };

// testDownloadImage();

// // testPinterest();

// const startTime = Date.now();
// const imageUrl = 'https://i.pinimg.com/564x/00/76/d9/0076d9609e8326daa46d06facb984691.jpg';
// await imageDownloaderService.downloadImage(imageUrl);
// // Wait for 10 seconds to allow the image download to complete
// // console.log('Waiting for 10 seconds...');
// // await new Promise(resolve => setTimeout(resolve, 10000));
// // console.log('Finished waiting, now retrieving image buffer...');

// const imageBuffer = await imageDownloaderService.getImageBuffer(imageUrl);
// console.log(imageBuffer);
// const endTime = Date.now();
// console.log(`Time taken Buffer: ${(endTime - startTime) / 1000}s`);

// const internalImageUrl = await imageDownloaderService.getInternalImageUrl(imageUrl);
// console.log(internalImageUrl);
// const endTime2 = Date.now();
// console.log(`Time taken Internal URL: ${(endTime2 - endTime) / 1000}s`);

// const startTime = Date.now();
// const imageUrl = 'https://i.pinimg.com/736x/91/84/ce/9184ce1f73524f75268088ae7829b51b.jpg';
// await productImageService.insertProductImageFromExternalUrl(imageUrl);

// const image = await productImageService.getImageAndWaitForEmbeddingIfProcessing(imageUrl);
// console.log(image);
// const endTime = Date.now();
// console.log(`Time taken to get embeddings: ${(endTime - startTime) / 1000}s`);

const exploreRequestId = '66b3ba0c-80bc-43f2-827c-db00ad0dcc48';
const productImagePreferences =
  await imagePreferenceService.getImagePreferencesForRequest(exploreRequestId);

logService.info(`Got ${productImagePreferences.length} image preferences for request`, {
  metadata: {
    productImagePreferences,
  },
  serviceName: 'ExploreAgent',
});
