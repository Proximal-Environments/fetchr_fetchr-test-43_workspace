import { injectable } from 'inversify';
import { BaseService } from '../../base/service_injection/baseService';
import { WebClient, KnownBlock } from '@slack/web-api';

export interface UserInfo {
  id?: string;
  name?: {
    firstName?: string;
    lastName?: string;
  };
  email?: string;
  phoneNumber?: string;
}

@injectable()
export class SlackService extends BaseService {
  private slackClient: WebClient;

  constructor() {
    super('SlackService');
    this.slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
  }

  /**
   * Formats user information consistently for Slack messages
   * @param user - User information object
   * @param options - Formatting options
   * @returns Formatted user string
   */
  formatUserInfo(user: UserInfo, options?: { includeId?: boolean; compact?: boolean }): string {
    const { includeId = true, compact = false } = options || {};

    const parts: string[] = [];

    // Add name
    const fullName = [user.name?.firstName, user.name?.lastName].filter(Boolean).join(' ');

    if (fullName) {
      parts.push(fullName);
    }

    // Add email
    if (user.email) {
      parts.push(user.email);
    }

    // Add phone number
    if (user.phoneNumber) {
      parts.push(user.phoneNumber);
    }

    // Add ID if requested
    if (includeId && user.id) {
      parts.push(`ID: ${user.id}`);
    }

    if (parts.length === 0) {
      return 'Unknown User';
    }

    // Format based on compact option
    if (compact) {
      return parts.join(' | ');
    } else {
      return parts.join('\n• ');
    }
  }

  /**
   * Creates a standardized user info block for Slack messages
   * @param user - User information object
   * @param label - Label for the user (e.g., "Customer", "User")
   * @returns Slack block with formatted user information
   */
  createUserInfoBlock(user: UserInfo, label: string = 'User'): string {
    const userInfo = this.formatUserInfo(user, { includeId: true, compact: false });
    return `*${label}:*\n• ${userInfo}`;
  }

  async sendMessage(
    channelId: string,
    message: string,
    options?: {
      threadTs?: string;
      blocks?: KnownBlock[];
    },
  ): Promise<boolean> {
    try {
      await this.slackClient.chat.postMessage({
        channel: channelId,
        text: message,
        thread_ts: options?.threadTs,
        blocks: options?.blocks,
      });

      return true;
    } catch (error) {
      this.logService.error('Error sending Slack message', {
        metadata: { channelId, message },
        error,
      });
      throw error;
    }
  }

  /**
   * Sends a message with standardized user information
   * @param channelId - Slack channel ID
   * @param message - Base message
   * @param user - User information to include
   * @param options - Additional options
   */
  async sendMessageWithUserInfo(
    channelId: string,
    message: string,
    user: UserInfo,
    options?: {
      threadTs?: string;
      userLabel?: string;
      additionalBlocks?: KnownBlock[];
    },
  ): Promise<boolean> {
    const { threadTs, userLabel = 'User', additionalBlocks = [] } = options || {};

    const userInfoBlock = this.createUserInfoBlock(user, userLabel);

    const blocks: KnownBlock[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${message}\n\n${userInfoBlock}`,
        },
      },
      ...additionalBlocks,
    ];

    return this.sendMessage(channelId, message, {
      threadTs,
      blocks,
    });
  }
}
