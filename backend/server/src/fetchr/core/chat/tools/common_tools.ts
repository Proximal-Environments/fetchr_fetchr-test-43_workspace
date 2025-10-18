import { ToolResultBlockParam } from '@anthropic-ai/sdk/resources';
import { BaseToolUsageResponsePayload } from '../baseToolPayloads';

export class ErrorResponsePayload extends BaseToolUsageResponsePayload {
  public error: string;

  constructor({ error }: { error: string }) {
    super('error');
    this.error = error;
  }

  public override toToolResultBlock(toolId: string): ToolResultBlockParam {
    return {
      tool_use_id: toolId,
      type: 'tool_result',
      content: this.error,
      is_error: true,
    };
  }
}

export class ExecutingNonBlockingResponsePayload extends BaseToolUsageResponsePayload {
  public message = 'Tool executed. Continue';

  constructor() {
    super('executing_non_blocking');
  }

  public override toToolResultBlock(toolId: string): ToolResultBlockParam {
    return {
      tool_use_id: toolId,
      type: 'tool_result',
      content: this.message,
      is_error: false,
    };
  }
}

export class ExecutingOutsideResponsePayload extends BaseToolUsageResponsePayload {
  public message =
    'Executing tool in the background. Will respond back when done (if response is needed).';

  constructor() {
    super('executing_outside');
  }

  public override toToolResultBlock(toolId: string): ToolResultBlockParam {
    return {
      tool_use_id: toolId,
      type: 'tool_result',
      content: this.message,
      is_error: false,
    };
  }
}

export const ExecutingNonBlockingTool = {
  responseClass: ExecutingNonBlockingResponsePayload,
};

export const ExecutingOutsideTool = {
  responseClass: ExecutingOutsideResponsePayload,
};

export const ErrorTool = {
  responseClass: ErrorResponsePayload,
};
