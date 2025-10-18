import { TemporaryChatHistory } from '../../core/chat/chatHistory';
import { openAIService } from '../../base/service_injection/global';
import { z } from 'zod';
import { OpenAIModel } from '@fetchr/schema/core/core';

export async function analyzeEmailWithImage(emailContent: string): Promise<{
  isTrackingOrOrderEmail: boolean;
  trackingUrls?: string[];
  trackingNumbers?: string[];
  orderId?: string;
  orderCancelledOrFailed?: boolean;
}> {
  // First, take a screenshot of the email content using Stagehand
  // const stagehand = new Stagehand({
  //   env: 'BROWSERBASE',
  //   waitForCaptchaSolves: true,
  //   selfHeal: true,
  // });

  // await stagehand.init();

  try {
    // Create a data URL from the HTML content
    // const dataUrl = `data:text/html,${encodeURIComponent(emailContent)}`;

    // Navigate to the data URL
    // await stagehand.page.goto(dataUrl, { timeout: 10_000 });

    // Take a screenshot
    // const screenshot = (await stagehand.page.screenshot({
    //   fullPage: true,
    //   type: 'jpeg',
    //   quality: 80,
    // })) as Buffer;

    // await stagehand.close().catch(error => {
    //   console.error('Error closing stagehand', error);
    // });

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
        // {
        //   type: 'image',
        //   image: screenshot,
        //   caption: 'Email content screenshot',
        // },
      ],
    });

    // Add the image message
    await chatHistory.addMessage({
      role: 'user',
      content: [
        // {
        //   type: 'image',
        //   image: screenshot,
        //   caption: 'Email content screenshot',
        // },
        {
          type: 'text',
          text: `Here is the email:\n${emailContent}`,
        },
        {
          type: 'text',
          text: `Please analyze this email content and determine if it contains tracking or order information
When extracting tracking numbers and urls: 
- Include all urls that you think could be tracking urls
- Include all tracking numbers that you think could be tracking numbers
- If you are unsure, it's always better to return more tracking numbers and urls`,
        },
      ],
    });

    // Get OpenAI messages
    const openAiMessages = await chatHistory.getOpenAiMessages();

    // First stage: Check if it's a tracking/order email and if it's cancelled
    const initialAnalysis = await openAIService.submitChatCompletion(openAiMessages, {
      zodSchema: z.object({
        isTrackingOrOrderEmail: z
          .boolean()
          .describe('Whether the email is a tracking or order email'),
        orderCancelledOrFailed: z
          .boolean()
          .nullable()
          .describe(
            'Whether the order was cancelled or failed (for any issues with the order, shipment or payment)',
          ),
      }),
      model: OpenAIModel.GPT_4_1_MINI,
    });

    // If not a tracking/order email, return early
    if (!initialAnalysis.isTrackingOrOrderEmail) {
      return {
        isTrackingOrOrderEmail: false,
        trackingUrls: [],
        trackingNumbers: [],
        orderCancelledOrFailed: initialAnalysis.orderCancelledOrFailed ?? false,
      };
    }

    // Second stage: Extract all possible tracking URLs and numbers
    const detailedAnalysis = await openAIService.submitChatCompletion(openAiMessages, {
      zodSchema: z.object({
        trackingUrls: z
          .array(z.string())
          .describe(
            "All possible tracking URLs found in the email. Include full URLs with query params. Only include URLs that are specifically for tracking packages. If you are unsure, it's always better to return more tracking URLs.",
          ),
        trackingNumbers: z
          .array(z.string())
          .describe(
            "All possible tracking numbers found in the email. Only include the numbers themselves without labels. For example if it says Number: 1234567890, return 1234567890. If you are unsure, it's always better to return more tracking numbers.",
          ),
      }),
      model: OpenAIModel.O3_MINI,
    });

    const response = {
      isTrackingOrOrderEmail: true,
      trackingUrls: detailedAnalysis.trackingUrls,
      trackingNumbers: detailedAnalysis.trackingNumbers,
      orderCancelledOrFailed: initialAnalysis.orderCancelledOrFailed,
    };

    return {
      ...response,
      orderCancelledOrFailed: response.orderCancelledOrFailed ?? false,
    };
  } finally {
    // Close the browser
    // await stagehand.close().catch(error => {
    //   console.error('Error closing stagehand', error);
    // });
  }
}
