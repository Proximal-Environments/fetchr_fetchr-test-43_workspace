import { TaskPayload } from '@trigger.dev/sdk/v3';
import { judgeOrderSuggestionTask } from './judge_order_suggestion_task';

export type JudgeOrderSuggestionPayload = TaskPayload<typeof judgeOrderSuggestionTask>;
