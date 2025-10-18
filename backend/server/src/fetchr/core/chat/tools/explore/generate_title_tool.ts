import { z } from 'zod';
import { BaseToolUsageRequestPayload, BaseToolUsageResponsePayload } from '../../baseToolPayloads';
import { ToolFunctionInputType } from '../../types';
import { ToolUseBlockParam } from '@anthropic-ai/sdk/resources';

export class GenerateTitleRequestPayload extends BaseToolUsageRequestPayload {
  public generated_title: string;

  constructor(input: ToolFunctionInputType<'generate_title'>) {
    super('generate_title');
    this.generated_title = input.generated_title;
  }

  static override fromToolUseBlock(
    toolUseBlock: ToolUseBlockParam & { input: ToolFunctionInputType<'generate_title'> },
  ): GenerateTitleRequestPayload {
    return new GenerateTitleRequestPayload(toolUseBlock.input);
  }

  override createRequestInput(): ToolFunctionInputType<'generate_title'> {
    return {
      generated_title: this.generated_title,
    };
  }
}

export class GenerateTitleResponsePayload extends BaseToolUsageResponsePayload {
  public title: string;

  constructor({ title }: { title: string }) {
    super('generate_title');
    this.title = title;
  }
}

export const GenerateTitleTool = {
  requestClass: GenerateTitleRequestPayload,
  responseClass: GenerateTitleResponsePayload,
  functionSchema: {
    name: 'generate_title',
    description: 'Generate a short title (2-5 words) for a shopping request',
    input: z.object({
      generated_title: z.string().describe('The generated title for the shopping request'),
    }),
  },
};
