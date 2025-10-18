import 'reflect-metadata';
import { logger, task } from '@trigger.dev/sdk/v3';
import { initLazyServices } from '../fetchr/core/lazyServices';
import { taskIds } from './task_ids';

export const judgeOrderSuggestionTask = task({
  id: taskIds.JUDGE_ORDER_SUGGESTION,
  maxDuration: 60 * 60 * 1000, // 1 hour in milliseconds
  run: async (payload: { orderSuggestionId: string }, _context) => {
    logger.log('Judge order suggestion task started', {
      payload,
    });

    const { orderAutomationService } = await initLazyServices();

    try {
      logger.info('Judging order suggestion');
      await orderAutomationService.judgeOrderSuggestion(payload.orderSuggestionId);
      return { success: true, completed: true };
    } catch (error) {
      logger.error('Error in judge order suggestion task', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
  machine: { preset: 'medium-1x' },
});
