import { injectable } from 'inversify';
import { BaseService } from '../../base/service_injection/baseService';
import { CreateThreadOnProductPurchaseSuggestionResponse } from '@fetchr/schema/automation/automation';
import { supabaseDb } from '../../base/database/supabaseDb';
import {
  convertThreadStatusToDbThreadStatus,
  convertThreadTypeToDbThreadType,
} from '../../../shared/converters';
import { ThreadStatus, ThreadType } from '@fetchr/schema/base/comments';

@injectable()
export class CommentingService extends BaseService {
  constructor() {
    super('CommentingService');
  }

  async createThreadOnProductPurchaseSuggestion({
    productPurchaseSuggestionId,
    userId,
    userName,
    threadType,
    content,
  }: {
    productPurchaseSuggestionId: string;
    userId: string;
    userName: string;
    threadType: ThreadType;
    content: string;
  }): Promise<CreateThreadOnProductPurchaseSuggestionResponse> {
    // Create a new thread in the database
    const thread = await supabaseDb.threads.create({
      data: {
        thread_type: convertThreadTypeToDbThreadType(threadType),
        thread_status: convertThreadStatusToDbThreadStatus(
          threadType === ThreadType.THREAD_TYPE_COMMENT
            ? ThreadStatus.THREAD_STATUS_NOT_APPLICABLE
            : ThreadStatus.THREAD_STATUS_OPEN,
        ),
      },
    });

    // Create the relationship between thread and product purchase suggestion
    await supabaseDb.product_purchase_suggestion_thread.create({
      data: {
        id: thread.id,
        thread_id: thread.id,
        product_purchase_suggestion_id: productPurchaseSuggestionId,
      },
    });

    await supabaseDb.thread_messages.create({
      data: {
        thread_id: thread.id,
        user_id: userId,
        user_name: userName,
        content,
      },
    });

    return {
      threadId: thread.id,
    };
  }

  async respondToThread({
    threadId,
    userId,
    userName,
    content,
  }: {
    threadId: number;
    userId: string;
    userName: string;
    content: string;
  }): Promise<void> {
    await supabaseDb.thread_messages.create({
      data: { thread_id: threadId, user_id: userId, user_name: userName, content },
    });
  }

  async resolveThread({ threadId }: { threadId: number }): Promise<void> {
    await supabaseDb.threads.update({
      where: { id: threadId },
      data: {
        thread_status: convertThreadStatusToDbThreadStatus(ThreadStatus.THREAD_STATUS_RESOLVED),
      },
    });
  }

  async editMessage({ messageId, content }: { messageId: number; content: string }): Promise<void> {
    await supabaseDb.thread_messages.update({
      where: { id: messageId },
      data: { content },
    });
  }
}
