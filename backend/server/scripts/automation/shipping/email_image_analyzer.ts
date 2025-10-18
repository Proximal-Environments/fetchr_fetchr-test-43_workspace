import { TemporaryChatHistory } from '../../../src/fetchr/core/chat/chatHistory';
import { openAIService } from '../../../src/fetchr/base/service_injection/global';
import { z } from 'zod';
import { OpenAIModel } from '@fetchr/schema/core/core';
import { Stagehand } from '@browserbasehq/stagehand';

export async function analyzeEmailWithImage(emailContent: string): Promise<{
  isTrackingOrOrderEmail: boolean;
  trackingUrl?: string;
  trackingNumber?: string;
  orderId?: string;
  orderCancelledOrFailed?: boolean;
}> {
  // First, take a screenshot of the email content using Stagehand
  const stagehand = new Stagehand({
    env: 'BROWSERBASE',
    waitForCaptchaSolves: true,
    selfHeal: true,
  });

  await stagehand.init();

  try {
    // Create a data URL from the HTML content
    const dataUrl = `data:text/html,${encodeURIComponent(emailContent)}`;

    // Navigate to the data URL
    await stagehand.page.goto(dataUrl).catch(error => {
      console.error('Error navigating to data URL', error);
    });

    // Take a screenshot
    const screenshot = (await stagehand.page.screenshot({
      fullPage: true,
      type: 'jpeg',
      quality: 80,
    })) as Buffer;

    await stagehand.close().catch(error => {
      console.error('Error closing stagehand', error);
    });

    // Create a temporary chat history
    const chatHistory = new TemporaryChatHistory();

    // Add the image to the chat history
    await chatHistory.addMessage({
      role: 'system',
      content: [
        {
          type: 'text',
          text: `You are a helpful assistant that analyzes email content to determine if it is a tracking or order update email.
Your task is to filter out emails that are not related to order confirmations, shipping notifications, 
delivery updates, order cancellations, or tracking information. Only classify an email as a tracking or order email if it 
contains specific information such as order numbers, tracking numbers, shipping details, or purchase confirmations.
Return false for all other types of emails including newsletters, promotions, or personal communications.`,
        },
      ],
    });

    // Add the image message
    await chatHistory.addMessage({
      role: 'user',
      content: [
        {
          type: 'image',
          image: screenshot,
          caption: 'Email content screenshot',
        },
        {
          type: 'text',
          text: `Here is the email:\n${emailContent}`,
        },
        {
          type: 'text',
          text: 'Please analyze this email content and determine if it contains tracking or order information.',
        },
      ],
    });

    // Get OpenAI messages
    const openAiMessages = await chatHistory.getOpenAiMessages();

    // Send to OpenAI for analysis
    const response = await openAIService.submitChatCompletion(openAiMessages, {
      zodSchema: z.object({
        isTrackingOrOrderEmail: z
          .boolean()
          .describe('Whether the email is a tracking or order email'),
        trackingUrl: z
          .string()
          .nullable()
          .describe('The full tracking URL. DO NOT LEAVE OUT QUERY PARAMS OR ANYTHING ELSE'),
        trackingNumber: z.string().nullable().describe('The tracking number (NOT THE ORDER ID)'),
        orderId: z.string().nullable().describe('The order ID (NOT THE TRACKING NUMBER)'),
        orderCancelledOrFailed: z
          .boolean()
          .nullable()
          .describe(
            'Whether the order was cancelled or failed (for any issues with the order, shipment or payment)',
          ),
      }),
      model: OpenAIModel.GPT_4_1_MINI,
    });

    if (response.trackingUrl) {
      const decodedTrackingUrl = decodeURIComponent(response.trackingUrl);
      response.trackingUrl = decodedTrackingUrl;
    }

    return {
      ...response,
      trackingUrl: response.trackingUrl ?? undefined,
      trackingNumber: response.trackingNumber ?? undefined,
      orderId: response.orderId ?? undefined,
      orderCancelledOrFailed: response.orderCancelledOrFailed ?? false,
    };
  } finally {
    // Close the browser
    await stagehand.close().catch(error => {
      console.error('Error closing stagehand', error);
    });
  }
}
