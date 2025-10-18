// import dotenv from 'dotenv';
// import { orderManagementService } from '../../../src/fetchr/base/service_injection/global';
// import { z } from 'zod';
// import { Stagehand } from '@browserbasehq/stagehand';
// import { analyzeEmailWithImage as extractShippingAndOrderInformationFromEmail } from './email_image_analyzer';
// import { supabaseDb } from '../../../src/fetchr/base/database/supabaseDb';
// import pLimit from 'p-limit';
// import { logService } from '../../../src/fetchr/base/logging/logService';
// const { default: Nylas } = await import('nylas');
// // Load environment variables
// dotenv.config();

// // Define interfaces for Nylas message types
// interface NylasRecipient {
//   email: string;
//   name: string;
// }

// interface NylasMessage {
//   id: string;
//   subject: string;
//   from: NylasRecipient[];
//   to: NylasRecipient[];
//   cc?: NylasRecipient[];
//   bcc?: NylasRecipient[];
//   date: number;
//   body: string;
//   attachments?: {
//     filename: string;
//     size: number;
//   }[];
// }

// // Initialize Nylas with the provided API key and URL
// // @ts-expect-error: Nylas ESM/TS export workaround
// const nylas = new Nylas({
//   apiKey: 'nyk_v0_X6xqudoVIQRAi2hZS5OjJQKv6QmQijLTWcI3KQRaER2odL5p5sLav0BCmXCr4dpc',
//   apiUri: 'https://api.us.nylas.com',
// });

// export async function getTrackingNumberFromUrl(url: string): Promise<string | null> {
//   const stagehand = new Stagehand({
//     env: 'BROWSERBASE',
//     waitForCaptchaSolves: true,
//     selfHeal: true,
//   });

//   await stagehand.init();

//   await stagehand.page.goto(url);

//   const { trackingNumber } = await stagehand.page.extract({
//     instruction: 'Extract the tracking number from the page',
//     schema: z.object({
//       trackingNumber: z.string().describe('The tracking number').nullable(),
//     }),
//   });

//   if (trackingNumber && trackingNumber.trim() !== '') {
//     return trackingNumber;
//   }

//   console.log('Tracking number:', JSON.stringify(trackingNumber, null, 2));

//   return null;
// }

// // Process emails in batches until all are processed
// export async function processAllEmailsInShippingEmails(
//   identifier: string = '5df1321e-9809-4c45-add0-3f4a377266fb',
//   batchSize: number = 100,
//   concurrencyLimit: number = 5,
// ): Promise<void> {
//   let page = 1;
//   let totalProcessed = 0;
//   let hasMoreEmails = true;

//   console.log(
//     `Starting to process emails in batches of ${batchSize} with concurrency of ${concurrencyLimit}...`,
//   );

//   while (hasMoreEmails) {
//     console.log(`Processing batch ${page}...`);

//     try {
//       const { processedCount, hasMore } = await processEmailBatch(
//         identifier,
//         batchSize,
//         page,
//         concurrencyLimit,
//       );
//       totalProcessed += processedCount;
//       hasMoreEmails = hasMore;

//       if (!hasMoreEmails) {
//         console.log(`No more emails to process. Completed processing ${totalProcessed} emails.`);
//         break;
//       }

//       page++;
//       console.log(
//         `Processed ${processedCount} emails in this batch. Total processed: ${totalProcessed}`,
//       );
//     } catch (error) {
//       console.error(`Error processing batch ${page}:`, error);
//       throw error;
//     }
//   }
// }

// async function processEmailBatch(
//   identifier: string,
//   limit: number = 100,
//   page: number = 1,
//   concurrency: number = 5,
// ): Promise<{ processedCount: number; hasMore: boolean }> {
//   try {
//     // Get a batch of emails
//     const messages = await nylas.messages.list({
//       identifier,
//       queryParams: {
//         limit,
//       },
//     });

//     console.log(`Retrieved ${messages.data.length} emails for batch ${page}`);

//     if (messages.data.length === 0) {
//       return { processedCount: 0, hasMore: false };
//     }

//     // Create a concurrency limiter
//     const concurrencyLimit = pLimit(concurrency);
//     let processedCount = 0;

//     // Create an array to track which messages are already processed
//     const processedIds = new Set<string>();

//     // First, check all messages in parallel to see which ones need processing
//     const checkPromises = messages.data.map((message: NylasMessage) =>
//       concurrencyLimit(async () => {
//         try {
//           const existingRecord = await supabaseDb.processed_emails.findFirst({
//             where: {
//               email_id: message.id,
//             },
//           });

//           if (existingRecord) {
//             console.log(`Skipping already processed message: ${message.id}`);
//             processedIds.add(message.id);
//           }

//           return message.id;
//         } catch (error) {
//           console.error(`Error checking if message ${message.id} was processed:`, error);
//           // If there's an error checking, we'll try to process it anyway
//           return message.id;
//         }
//       }),
//     );

//     await Promise.all(checkPromises);

//     // Filter out messages that have already been processed
//     const messagesToProcess = messages.data.filter(
//       (message: NylasMessage) => !processedIds.has(message.id),
//     );
//     logService.info(`Found ${messagesToProcess.length} new messages to process`, {
//       metadata: {
//         messageIds: messagesToProcess.map((message: NylasMessage) => message.subject),
//       },
//     });

//     // Process messages in parallel with concurrency limit
//     const processPromises = messagesToProcess.map((message: NylasMessage) =>
//       concurrencyLimit(async () => {
//         try {
//           // Process the message
//           await processEmail(message as NylasMessage);

//           // Mark the message as processed
//           await supabaseDb.processed_emails.create({
//             data: {
//               email_id: message.id,
//             },
//           });

//           processedCount++;
//           return true;
//         } catch (error) {
//           console.error(`Error processing message ${message.id}:`, error);
//           return false;
//         }
//       }),
//     );

//     await Promise.all(processPromises);

//     // Check if there are more emails to process
//     const hasMore = messages.data.length === limit;

//     return { processedCount, hasMore };
//   } catch (error) {
//     console.error('Error processing email batch:', error);
//     throw error;
//   }
// }

// async function processEmail(message: NylasMessage): Promise<void> {
//   console.log(`\n--- Processing Email ID: ${message.id} ---`);
//   console.log(
//     `From: ${message.from?.[0]?.name || 'Unknown'} <${message.from?.[0]?.email || 'Unknown'}>`,
//   );

//   // Display all recipients
//   if (message.to && message.to.length > 0) {
//     message.to.forEach((recipient: NylasRecipient, i: number) => {
//       console.log(
//         `To (${i + 1}): ${recipient.name || 'Unknown'} <${recipient.email || 'Unknown'}>`,
//       );
//     });
//   } else {
//     console.log('To: No recipients');
//   }

//   console.log(`Subject: ${message.subject}`);
//   console.log(`Date: ${new Date(message.date * 1000).toLocaleString()}`);

//   // Extract important information
//   const shipmentId = message.to?.[0]?.email?.split('@')[0].split('+')[1] || '';
//   let trackingNumber: string | null = null;

//   // Create HTML content for the email
//   const emailHtml = `
//     <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px;">
//       <div style="margin-bottom: 20px;">
//         <strong>From:</strong> ${message.from?.[0]?.name || 'Unknown'} &lt;${
//     message.from?.[0]?.email || 'Unknown'
//   }&gt;
//       </div>
//       <div style="margin-bottom: 20px;">
//         <strong>Subject:</strong> ${message.subject}
//       </div>
//       <div style="margin-bottom: 20px;">
//         <strong>Date:</strong> ${new Date(message.date * 1000).toLocaleString()}
//       </div>
//       <div style="border-top: 1px solid #ccc; padding-top: 20px;">
//         ${message.body || 'No body content'}
//       </div>
//     </div>
//   `;

//   const response = await extractShippingAndOrderInformationFromEmail(emailHtml);
//   console.log(`Email ${message.id} Response:`, JSON.stringify(response, null, 2));
//   const { isTrackingOrOrderEmail, trackingUrl, orderCancelledOrFailed } = response;
//   trackingNumber = response.trackingNumber ?? null;

//   if (isTrackingOrOrderEmail) {
//     console.log(`Email ${message.id} is a tracking or order email`);
//     console.log('Shipment ID from email:', shipmentId);
//     if (trackingUrl) {
//       console.log('Tracking URL:', trackingUrl);
//     }

//     if (trackingNumber) {
//       console.log('Tracking Number:', trackingNumber);
//     }

//     if (!trackingUrl && !trackingNumber) {
//       console.log('No tracking URL or tracking number found');
//       return;
//     }

//     if (trackingUrl && !trackingNumber) {
//       const trackingNumberFromUrl = await getTrackingNumberFromUrl(trackingUrl);
//       console.log('Tracking number from URL:', trackingNumberFromUrl);
//       if (trackingNumberFromUrl && !trackingNumber) {
//         trackingNumber = trackingNumberFromUrl;
//       }
//     }

//     if (!trackingNumber) {
//       console.log('No tracking number found');
//       return;
//     }

//     if (orderCancelledOrFailed) {
//       throw new Error('Order was cancelled or failed. Not implemented yet.');
//     }

//     if (shipmentId) {
//       const shipment = await orderManagementService.getShipment(shipmentId);
//       if (shipment) {
//         console.log('Shipment:', shipment);
//       }
//     }
//   } else {
//     console.log(`Email ${message.id} is not a tracking or order email`);
//   }
// }

// // Execute the function with customizable concurrency
// // Default concurrency: 5 parallel processes
// processAllEmailsInShippingEmails('5df1321e-9809-4c45-add0-3f4a377266fb', 100, 5)
//   .then(() => {
//     console.log('\nDone processing all emails.');
//     process.exit(0);
//   })
//   .catch(error => {
//     console.error('Script failed:', error);
//     process.exit(1);
//   });
