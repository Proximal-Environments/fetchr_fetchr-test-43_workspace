import Nylas from 'nylas';
import { z } from 'zod';
import pLimit from 'p-limit';
import { Stagehand } from '@browserbasehq/stagehand';
import { supabaseDb } from '../../base/database/supabaseDb';
import { BaseService } from '../../base/service_injection/baseService';
import { injectable, inject } from 'inversify';
import 'reflect-metadata';
import { OrderManagementService } from '../orderManagement/orderManagementsService';
import { analyzeEmailWithImage } from './email_image_analyzer';
import { getSimplifiedHtml } from './emailSimplifier';
import { SlackService } from '../slack/slackService';
import { ShipmentTrackingService } from './shipmentTrackingService';
import { Perf } from '../../core/performance/performance';
import { logService } from '../../base/logging/logService';
import { shipmentTrackingService } from '../../base/service_injection/global';

interface NylasRecipient {
  email: string;
  name: string;
}

interface NylasMessage {
  id: string;
  subject: string;
  from: NylasRecipient[];
  to: NylasRecipient[];
  cc?: NylasRecipient[];
  bcc?: NylasRecipient[];
  date: number;
  body: string;
  attachments?: {
    filename: string;
    size: number;
  }[];
}

const NYLAS_EMAIL_TO_IDENTIFIER_MAP = {
  'navid.dhaliwal@gmail.com': '460934cb-35dc-49ce-86cb-65978c2fe4d2',
};

export const DEFAULT_EMAIL: keyof typeof NYLAS_EMAIL_TO_IDENTIFIER_MAP = 'navid.dhaliwal@gmail.com';

export interface ShippingEmailServiceConfig {
  nylasApiKey: string;
  nylasApiUri: string;
  stagehandEnv: 'LOCAL' | 'BROWSERBASE';
  defaultIdentifier: string;
  defaultBatchSize: number;
  defaultConcurrencyLimit: number;
}

@injectable()
export class ShippingEmailService extends BaseService {
  private nylas: Nylas;
  private config: ShippingEmailServiceConfig;

  constructor(
    @inject(OrderManagementService) private orderManagementService: OrderManagementService,
    @inject(SlackService) private slackService: SlackService,
    @inject(ShipmentTrackingService) private shipmentTrackingService: ShipmentTrackingService,
    @inject(Perf) private perf: Perf,
  ) {
    super('ShippingEmailService');
    this.config = this.initializeDefaultConfig();
    this.nylas = new Nylas({
      apiKey: process.env.NYLAS_API_KEY || '',
      apiUri: process.env.NYLAS_API_URI || 'https://api.us.nylas.com',
    });
  }

  private initializeDefaultConfig(): ShippingEmailServiceConfig {
    // Default configuration - should be overridden by initialize() call
    return {
      nylasApiKey: process.env.NYLAS_API_KEY || '',
      nylasApiUri: process.env.NYLAS_API_URI || 'https://api.us.nylas.com',
      stagehandEnv: 'BROWSERBASE',
      defaultIdentifier: NYLAS_EMAIL_TO_IDENTIFIER_MAP[DEFAULT_EMAIL],
      defaultBatchSize: 100,
      defaultConcurrencyLimit: 5,
    };
  }

  /**
   * Process all emails in batches from the specified mailbox identifier
   */
  public async processAllEmails(
    identifier: string = this.config.defaultIdentifier,
    batchSize: number = this.config.defaultBatchSize,
    concurrencyLimit: number = this.config.defaultConcurrencyLimit,
  ): Promise<void> {
    let page = 1;
    let totalProcessed = 0;
    let hasMoreEmails = true;

    this.logService.info(
      `Starting to process emails in batches of ${batchSize} with concurrency of ${concurrencyLimit}...`,
      { metadata: { identifier, batchSize, concurrencyLimit } },
    );

    while (hasMoreEmails) {
      this.logService.info(`Processing batch ${page}...`);

      try {
        const { processedCount, hasMore } = await this.processEmailBatch(
          identifier,
          batchSize,
          page,
          concurrencyLimit,
        );
        totalProcessed += processedCount;
        hasMoreEmails = hasMore;

        if (!hasMoreEmails) {
          this.logService.info(
            `No more emails to process. Completed processing ${totalProcessed} emails.`,
          );
          break;
        }

        page++;
        this.logService.info(
          `Processed ${processedCount} emails in this batch. Total processed: ${totalProcessed}`,
        );
      } catch (error) {
        this.logService.error(`Error processing batch ${page}:`, { error: error as Error });
        throw error;
      }
    }
  }

  /**
   * Process a batch of emails from the specified mailbox identifier
   */
  private async processEmailBatch(
    identifier: string,
    limit: number = 100,
    page: number = 1,
    concurrency: number = 1,
  ): Promise<{ processedCount: number; hasMore: boolean }> {
    try {
      // Get a batch of emails
      const messages = await this.nylas.messages.list({
        identifier,
        queryParams: {
          limit,
        },
      });

      this.logService.info(`Retrieved ${messages.data.length} emails for batch ${page}`);

      if (messages.data.length === 0) {
        return { processedCount: 0, hasMore: false };
      }

      // Create a concurrency limiter
      const concurrencyLimit = pLimit(concurrency);
      let processedCount = 0;

      // Create an array to track which messages are already processed
      const processedIds = new Set<string>();

      // First, check all messages in parallel to see which ones need processing
      const checkPromises = messages.data.map(message =>
        concurrencyLimit(async () => {
          try {
            const existingRecord = await supabaseDb.processed_emails.findFirst({
              where: {
                email_id: message.id,
              },
            });

            if (existingRecord) {
              this.logService.debug(`Skipping already processed message: ${message.id}`);
              processedIds.add(message.id);
            }

            return message.id;
          } catch (error) {
            this.logService.error(`Error checking if message ${message.id} was processed:`, {
              error: error as Error,
            });
            // If there's an error checking, we'll try to process it anyway
            return message.id;
          }
        }),
      );

      await Promise.all(checkPromises);

      // Filter out messages that have already been processed
      const messagesToProcess = messages.data.filter(message => !processedIds.has(message.id));
      this.logService.info(`Found ${messagesToProcess.length} new messages to process`, {
        metadata: {
          messageIds: messagesToProcess.map(message => message.subject),
        },
      });

      // Process messages in parallel with concurrency limit
      const processPromises = messagesToProcess.map(message =>
        concurrencyLimit(async () => {
          try {
            // Process the message
            const success = await this.processEmail(message as NylasMessage);

            // Only mark the message as processed if processing was successful
            if (success) {
              await supabaseDb.processed_emails.create({
                data: {
                  email_id: message.id,
                },
              });
              processedCount++;
              return true;
            } else {
              this.logService.warn(
                `Message ${message.id} processing was not successful, will retry later`,
              );
              return false;
            }
          } catch (error) {
            this.logService.error(`Error processing message ${message.id}:`, {
              error: error as Error,
            });
            return false;
          }
        }),
      );

      await Promise.all(processPromises);

      // Check if there are more emails to process
      const hasMore = messages.data.length === limit;

      return { processedCount, hasMore };
    } catch (error) {
      this.logService.error('Error processing email batch:', { error: error as Error });
      throw error;
    }
  }

  /**
   * Process a single email message and extract shipping information
   */
  private async processEmail(message: NylasMessage): Promise<boolean> {
    const perfTracker = this.perf.start('shippingEmailService.processEmail');
    try {
      this.logService.info(`Processing Email ID: ${message.id}`, {
        metadata: {
          from: message.from?.[0]?.email,
          subject: message.subject,
        },
      });

      // Extract important information
      const emailAddress = message.to?.[0]?.email;
      const emailAddressSlug = emailAddress?.split('@')[0].split('+')[1] || '';

      const simplifiedHtml = getSimplifiedHtml(message.body);

      // Create HTML content for the email
      const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px;">
        <div style="margin-bottom: 20px;">
          <strong>From:</strong> ${message.from?.[0]?.name || 'Unknown'} &lt;${
        message.from?.[0]?.email || 'Unknown'
      }&gt;
        </div>
        <div style="margin-bottom: 20px;">
          <strong>Subject:</strong> ${message.subject}
        </div>
        <div style="margin-bottom: 20px;">
          <strong>Date:</strong> ${new Date(message.date * 1000).toLocaleString()}
        </div>
        <div style="border-top: 1px solid #ccc; padding-top: 20px;">
          ${simplifiedHtml}
        </div>
      </div>
    `;

      try {
        // Step 1: Analyze email with multiple parallel calls to determine if it's a tracking/order email
        const analysis = await this.analyzeEmailWithRetries(emailHtml, emailAddress, message.id);

        if (!analysis) {
          this.logService.error(`Failed to analyze email ${message.id}`, {
            metadata: { emailAddress },
          });
          // Return false to retry later
          return false;
        }

        const { isTrackingOrOrderEmail, trackingUrls, trackingNumbers, orderCancelledOrFailed } =
          analysis;

        // If not a tracking/order email, we're done
        if (!isTrackingOrOrderEmail) {
          return true;
        }

        this.logService.info(`Email ${message.id} is a tracking or order email`, {
          metadata: { emailAddress, emailAddressSlug },
        });

        // Handle cancelled/failed orders first
        if (orderCancelledOrFailed) {
          this.logService.warn('Order was cancelled or failed', {
            metadata: { emailAddress },
          });
          if (process.env.SLACK_AUTOMATIONS_CHANNEL_ID) {
            await this.slackService.sendMessage(
              process.env.SLACK_AUTOMATIONS_CHANNEL_ID,
              `Order was cancelled or failed.`,
              {
                blocks: [
                  {
                    type: 'section',
                    text: {
                      type: 'mrkdwn',
                      text:
                        `❌ *Order Cancellation/Failure Alert*\n` +
                        `• Email Address: ${emailAddress}\n` +
                        `• Email Subject: ${message.subject}\n` +
                        `• Email Date: ${new Date(message.date * 1000).toLocaleString()}\n`,
                    },
                  },
                ],
              },
            );
          }
          return true;
        }

        // Step 2: Check if we have any tracking numbers or URLs
        if (trackingNumbers.length === 0 && trackingUrls.length === 0) {
          this.logService.warn('No tracking URL or tracking number found', {
            metadata: { emailAddress },
          });
          return true;
        }

        const possibleTrackingNumbers: string[] = [];

        for (const trackingNumber of trackingNumbers) {
          this.logService.info(`Attempting to register tracking number ${trackingNumber}`, {
            metadata: { emailAddress },
          });

          const registered = await this.registerTrackingNumber(trackingNumber, emailAddress);

          if (registered) {
            possibleTrackingNumbers.push(trackingNumber);
            this.logService.info(`Successfully registered tracking number ${trackingNumber}`, {
              metadata: { emailAddress },
            });
          }
        }

        // Step 4: Try to extract from URLs
        if (trackingUrls.length > 0) {
          this.logService.info(
            `No tracking number registered, trying to extract from ${trackingUrls.length} URLs`,
            {
              metadata: { emailAddress },
            },
          );

          // Try each URL sequentially
          const registeredTrackingNumbers = await Promise.all(
            trackingUrls.map(url =>
              this.extractAndRegisterTrackingFromUrl(url, emailAddress).then(trackingNumber => ({
                url,
                trackingNumber,
              })),
            ),
          );

          for (const { url, trackingNumber } of registeredTrackingNumbers) {
            if (trackingNumber) {
              possibleTrackingNumbers.push(trackingNumber);
              this.logService.info(
                `Successfully extracted and registered tracking number from URL`,
                {
                  metadata: { url, trackingNumber, emailAddress },
                },
              );
            }
          }
        }

        // Step 5: Update shipment if we have a tracking number and shipment ID
        if (emailAddressSlug) {
          // Find the first valid tracking URL if we have one
          const trackingUrl = trackingUrls.length > 0 ? trackingUrls[0] : null;

          const updated = await this.updateShipment(
            emailAddressSlug,
            emailAddress,
            possibleTrackingNumbers,
            trackingUrl,
          );

          if (!updated) {
            this.logService.warn(`Failed to update shipment ${emailAddressSlug}`, {
              metadata: { emailAddress, trackingUrl, possibleTrackingNumbers },
            });
          }
        }

        // Step 6: Send notification if we couldn't register any tracking number
        if (possibleTrackingNumbers.length === 0) {
          this.logService.warn(
            'No tracking number found or registered after all extraction attempts',
            {
              metadata: { emailAddress },
            },
          );

          if (process.env.SLACK_AUTOMATIONS_CHANNEL_ID) {
            // Format tracking numbers and URLs for the message
            const trackingNumbersList =
              trackingNumbers.length > 0
                ? trackingNumbers.map(num => `• \`${num}\``).join('\n')
                : '• None found';

            const trackingUrlsList =
              trackingUrls.length > 0
                ? trackingUrls
                    .map(url => `• <${url}|${url.substring(0, 50)}${url.length > 50 ? '...' : ''}>`)
                    .join('\n')
                : '• None found';

            await this.slackService.sendMessage(
              process.env.SLACK_AUTOMATIONS_CHANNEL_ID,
              `Could not extract or register tracking number out of tracking / order email!`,
              {
                blocks: [
                  {
                    type: 'section',
                    text: {
                      type: 'mrkdwn',
                      text:
                        `🔍 *Tracking Number Extraction Failed*\n` +
                        `• Email Address: ${emailAddress}\n` +
                        `• Email Subject: ${message.subject}\n` +
                        `• Email Date: ${new Date(message.date * 1000).toLocaleString()}\n` +
                        `• From: ${message.from?.[0]?.name || 'Unknown'} <${
                          message.from?.[0]?.email || 'Unknown'
                        }>\n`,
                    },
                  },
                  {
                    type: 'section',
                    text: {
                      type: 'mrkdwn',
                      text: `*Tracking Numbers Attempted:*\n${trackingNumbersList}`,
                    },
                  },
                  {
                    type: 'section',
                    text: {
                      type: 'mrkdwn',
                      text: `*Tracking URLs Attempted:*\n${trackingUrlsList}`,
                    },
                  },
                ],
              },
            );
          }
        }

        return true;
      } catch (error) {
        this.logService.error(`Error processing email ${message.id}:`, {
          error: error as Error,
          metadata: { emailAddress },
        });
        return false;
      }
    } finally {
      this.perf.end(perfTracker);
    }
  }

  /**
   * Attempts to initialize and acquire a Stagehand object with retries
   */
  private async acquireStagehandObject(maxAttempts: number = 3): Promise<Stagehand | null> {
    const TIMEOUT_MS = 300000; // 5 minutes
    const RETRY_DELAY_MS = 5000; // 5 seconds between retries

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (!process.env.BROWSERBASE_PROJECT_ID) {
          throw new Error('BROWSERBASE_PROJECT_ID is not set');
        }

        const stagehand = new Stagehand({
          env: this.config.stagehandEnv,
          waitForCaptchaSolves: true,
          selfHeal: true,
          browserbaseSessionCreateParams: {
            projectId: process.env.BROWSERBASE_PROJECT_ID,
            browserSettings: {
              solveCaptchas: true,
            },
            proxies: true,
          },
        });

        await stagehand.init();

        this.logService.info('Successfully initialized Stagehand', {
          metadata: { attempt },
        });

        // Set a timeout to automatically close the Stagehand instance
        setTimeout(async () => {
          try {
            await stagehand.close();
            this.logService.info('Automatically closed Stagehand instance after timeout');
          } catch (error) {
            this.logService.error('Error closing Stagehand instance after timeout', {
              error: error as Error,
            });
          }
        }, TIMEOUT_MS);

        this.logService.info('Successfully initialized Stagehand', {
          metadata: { attempt },
        });

        return stagehand;
      } catch (error) {
        if (attempt === maxAttempts) {
          this.logService.error('Failed to initialize Stagehand after all attempts', {
            error: error as Error,
          });
          return null;
        }

        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }

    return null;
  }

  /**
   * Extract tracking number from a URL using Stagehand
   */
  private async getTrackingNumberFromUrl(url: string): Promise<string | null> {
    const stagehand = await this.acquireStagehandObject();
    if (!stagehand) {
      this.logService.error('Failed to acquire Stagehand object for URL extraction');
      return null;
    }

    try {
      await stagehand.page.goto(url);
      await new Promise(resolve => setTimeout(resolve, 30_000));

      const { trackingNumber } = await stagehand.page.extract({
        instruction: 'Extract the tracking number from the page',
        schema: z.object({
          trackingNumber: z
            .string()
            .describe(
              'The tracking number. Only include the number itself (without the tracking number label). For example if it says Number: 1234567890, return 1234567890.',
            )
            .optional(),
        }),
      });

      if (trackingNumber && trackingNumber.trim() !== '') {
        return trackingNumber;
      }

      this.logService.debug('Tracking number extraction result', {
        metadata: { trackingNumber },
      });
      return null;
    } catch (error) {
      this.logService.error(`Error extracting tracking number from URL ${url}:`, {
        error: error as Error,
      });
      return null;
    } finally {
      try {
        await stagehand.close();
      } catch (error) {
        this.logService.error('Error closing Stagehand instance', {
          error: error as Error,
        });
      }
    }
  }

  /**
   * Analyzes an email with LLM to extract tracking information
   */
  private async analyzeEmailWithImage(emailHtml: string): Promise<{
    isTrackingOrOrderEmail: boolean;
    trackingUrls?: string[];
    trackingNumbers?: string[];
    orderCancelledOrFailed?: boolean;
  } | null> {
    const stagehand = await this.acquireStagehandObject();
    if (!stagehand) {
      this.logService.error('Failed to acquire Stagehand object for email analysis');
      return null;
    }

    try {
      return await analyzeEmailWithImage(emailHtml);
    } catch (error) {
      this.logService.error('Error analyzing email with image:', {
        error: error as Error,
      });
      return null;
    } finally {
      try {
        await stagehand.close();
      } catch (error) {
        this.logService.error('Error closing Stagehand instance', {
          error: error as Error,
        });
      }
    }
  }

  /**
   * Attempts to analyze an email multiple times to determine if it's a tracking or order email
   * and extract tracking information.
   */
  private async analyzeEmailWithRetries(
    emailHtml: string,
    emailAddress: string,
    messageId: string,
  ): Promise<{
    isTrackingOrOrderEmail: boolean;
    trackingUrls: string[];
    trackingNumbers: string[];
    orderCancelledOrFailed?: boolean;
  } | null> {
    try {
      const result = await this.analyzeEmailWithImage(emailHtml);

      if (!result) {
        this.logService.error(`Analysis failed for email ${messageId}`, {
          metadata: { emailAddress },
        });
        return null;
      }

      if (!result.isTrackingOrOrderEmail) {
        this.logService.info(`Email ${messageId} is not a tracking or order email`, {
          metadata: { emailAddress },
        });
        return {
          isTrackingOrOrderEmail: false,
          trackingUrls: [],
          trackingNumbers: [],
        };
      }

      this.logService.info(`Analysis results for email ${messageId}`, {
        metadata: {
          emailAddress,
          trackingUrls: result.trackingUrls || [],
          trackingNumbers: result.trackingNumbers || [],
          orderCancelledOrFailed: result.orderCancelledOrFailed,
          isTrackingOrOrderEmail: result.isTrackingOrOrderEmail,
        },
      });

      return {
        isTrackingOrOrderEmail: result.isTrackingOrOrderEmail,
        trackingUrls: result.trackingUrls || [],
        trackingNumbers: result.trackingNumbers || [],
        orderCancelledOrFailed: result.orderCancelledOrFailed,
      };
    } catch (error) {
      this.logService.error(`Error analyzing email ${messageId}:`, {
        error: error as Error,
        metadata: { emailAddress },
      });
      return null;
    }
  }

  /**
   * Attempts to register a tracking number with the shipment tracking service
   */
  private async registerTrackingNumber(
    trackingNumber: string,
    emailAddress: string,
  ): Promise<boolean> {
    try {
      await this.shipmentTrackingService.registerTrackingNumber(trackingNumber);
      this.logService.info('Successfully registered tracking number', {
        metadata: { trackingNumber, emailAddress },
      });
      return true;
    } catch (error) {
      this.logService.error('Error registering tracking number', {
        error: error as Error,
        metadata: { trackingNumber, emailAddress },
      });
      return false;
    }
  }

  /**
   * Extracts tracking number from URL and attempts to register it
   */
  private async extractAndRegisterTrackingFromUrl(
    url: string,
    emailAddress: string,
  ): Promise<string | null> {
    this.logService.info(`Trying to extract tracking number from URL`, {
      metadata: { url, emailAddress },
    });

    // Get tracking number from URL
    const trackingNumber = await this.getTrackingNumberFromUrl(url);

    if (!trackingNumber) {
      this.logService.warn(`No tracking number found in URL`, {
        metadata: { url, emailAddress },
      });
      return null;
    }

    // Try to register the tracking number
    const registered = await this.registerTrackingNumber(trackingNumber, emailAddress);

    if (registered) {
      this.logService.info(`Successfully extracted and registered tracking number from URL`, {
        metadata: { url, trackingNumber, emailAddress },
      });
      return trackingNumber;
    }

    this.logService.warn(`Failed to extract and register valid tracking number from URL`, {
      metadata: { url, emailAddress },
    });
    return null;
  }

  /**
   * Updates shipment with tracking information
   */
  private async updateShipment(
    emailAddressSlug: string,
    emailAddress: string,
    possibleTrackingNumbers: string[],
    trackingUrl: string | null,
  ): Promise<boolean> {
    try {
      // Check if shipment exists
      const shipment = await this.orderManagementService.getShipmentUsingEmail(emailAddress);

      if (!shipment) {
        this.logService.warn(`No shipment found for email ${emailAddress}`, {
          metadata: { emailAddress },
        });
        return false;
      }

      // Check if shipment already has a tracking number
      if (shipment.trackingNumber) {
        this.logService.info(
          `Shipment already has tracking number ${shipment.trackingNumber}, skipping update`,
          {
            metadata: { emailAddress },
          },
        );
        return true;
      }

      const existingPossibleTrackingNumbers = shipment.possibleTrackingNumbers;

      const uniquePossibleTrackingNumbers = Array.from(
        new Set([...existingPossibleTrackingNumbers, ...possibleTrackingNumbers]),
      );

      // Update shipment with tracking information
      await this.orderManagementService.updateShipmentUrlAndTrackingNumbers(emailAddress, {
        possibleTrackingNumbers: uniquePossibleTrackingNumbers,
        trackingUrl: trackingUrl || undefined,
      });

      await Promise.all(
        uniquePossibleTrackingNumbers.map(async trackingNumber => {
          await this.shipmentTrackingService.updateShipmentStatus({
            shipmentId: shipment.id,
            tracking_number: trackingNumber,
          });
        }),
      );

      this.logService.info('Successfully updated shipment with tracking information', {
        metadata: { emailAddress, possibleTrackingNumbers, trackingUrl },
      });

      return true;
    } catch (error) {
      this.logService.error(`Error updating shipment ${emailAddress}:`, {
        error: error as Error,
        metadata: { emailAddress },
      });

      if (process.env.SLACK_AUTOMATIONS_CHANNEL_ID) {
        await this.slackService.sendMessage(
          process.env.SLACK_AUTOMATIONS_CHANNEL_ID,
          `Error updating shipment ${emailAddress}:`,
          {
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `Error updating shipment for email: ${emailAddress}: ${error}`,
                },
              },
            ],
          },
        );
      }

      return false;
    }
  }
}

/**
 * Parses HTML and extracts important elements with their essential attributes
 * @param htmlString The HTML string to parse
 * @returns An array of important elements with their attributes
 */
export function parseHtmlForImportantElements(htmlString: string): {
  element: string;
  attributes: Record<string, string>;
  textContent?: string;
  importance: number;
}[] {
  // Create a virtual DOM to parse the HTML
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');

  // Initialize array for important elements
  const importantElements: {
    element: string;
    attributes: Record<string, string>;
    textContent?: string;
    importance: number;
  }[] = [];

  // Define importance criteria
  const importanceScores: Record<string, number> = {
    button: 10,
    a: 9,
    input: 8,
    select: 7,
    textarea: 7,
    form: 6,
    nav: 5,
    header: 4,
    footer: 4,
    h1: 3,
    h2: 3,
    img: 2,
  };

  // Essential attributes to collect
  const essentialAttributes = [
    'id',
    'class',
    'href',
    'src',
    'aria-label',
    'aria-name',
    'aria-role',
    'aria-description',
    'aria-expanded',
    'aria-haspopup',
    'type',
    'value',
  ];

  // Helper function to collect attributes
  function getAttributes(element: Element): Record<string, string> {
    const attributes: Record<string, string> = {};

    // Get essential attributes
    essentialAttributes.forEach(attr => {
      const value = element.getAttribute(attr);
      if (value) attributes[attr] = value;
    });

    // Get data attributes
    Array.from(element.attributes).forEach(attr => {
      if (attr.name.startsWith('data-')) {
        attributes[attr.name] = attr.value;
      }
    });

    return attributes;
  }

  // Find all interactive elements
  const interactiveSelectors = [
    'button',
    'a',
    'input',
    'select',
    'textarea',
    'details',
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[tabindex]',
    '[contenteditable="true"]',
  ].join(',');

  const interactiveElements = doc.querySelectorAll(interactiveSelectors);

  // Process interactive elements
  interactiveElements.forEach(element => {
    const tagName = element.tagName.toLowerCase();
    const baseImportance = importanceScores[tagName] || 1;

    // Boost importance for elements with specific attributes
    let importanceBoost = 0;
    if (element.hasAttribute('id')) importanceBoost += 2;
    if (element.getAttribute('aria-label')) importanceBoost += 1;
    if (element.getAttribute('role')) importanceBoost += 1;

    // Check if visible (approximation since we can't check styles)
    if (
      element.hasAttribute('hidden') ||
      element.getAttribute('aria-hidden') === 'true' ||
      element.getAttribute('style')?.includes('display: none')
    ) {
      return; // Skip hidden elements
    }

    importantElements.push({
      element: tagName,
      attributes: getAttributes(element),
      textContent: element.textContent?.trim() || undefined,
      importance: baseImportance + importanceBoost,
    });
  });

  // Sort by importance
  return importantElements.sort((a, b) => b.importance - a.importance);
}

export async function checkAndUpdateShippingStatus(): Promise<void> {
  const shipmentsToCheck = await supabaseDb.shipment.findMany({
    where: {
      OR: [
        {
          tracking_number: {
            not: null,
          },
        },
        {
          possible_tracking_numbers: {
            isEmpty: false,
          },
        },
      ],
      status: {
        not: 'Delivered',
      },
    },
  });

  const filteredShipments = shipmentsToCheck.filter(
    shipment => shipment.tracking_number !== '' || shipment.possible_tracking_numbers.length > 0,
  );

  logService.info(`Checking ${filteredShipments.length} shipments`, {
    metadata: {
      filteredShipments,
    },
  });

  for (const shipment of filteredShipments) {
    try {
      const trackingNumbersToCheck = [
        shipment.tracking_number,
        ...(shipment.possible_tracking_numbers || []),
      ].filter(trackingNumber => trackingNumber !== null);

      await Promise.all(
        trackingNumbersToCheck.map(trackingNumber =>
          shipmentTrackingService.updateShipmentStatus({
            shipmentId: shipment.id,
            tracking_number: trackingNumber,
          }),
        ),
      );
    } catch (error) {
      logService.error(
        `Error updating shipping status for shipment ${shipment.id} with tracking ${shipment.tracking_number}:`,
        {
          error,
        },
      );
    }
  }
}
