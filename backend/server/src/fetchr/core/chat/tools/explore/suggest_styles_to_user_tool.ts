import { BaseToolUsageRequestPayload, BaseToolUsageResponsePayload } from '../../baseToolPayloads';
import { ToolResultBlockParam, ToolUseBlockParam } from '@anthropic-ai/sdk/resources';
import {
  ImagePreferenceItemWithStyle,
  ImageWithWidthAndHeight,
  PreferenceType,
} from '@fetchr/schema/base/base';
import { z } from 'zod';
import { ToolFunctionInputType } from '../../types';

export class SuggestStylesToUserRequestPayload extends BaseToolUsageRequestPayload {
  public styleQuery: string;

  public override metadata?: {
    images: ImageWithWidthAndHeight[];
  } = undefined;

  constructor({ styleQuery }: ToolFunctionInputType<'suggest_styles_to_user'>) {
    super('suggest_styles_to_user');
    this.styleQuery = styleQuery;
  }

  static override fromToolUseBlock(
    toolUseBlock: ToolUseBlockParam & {
      input: ToolFunctionInputType<'suggest_styles_to_user'>;
    },
  ): SuggestStylesToUserRequestPayload {
    return new SuggestStylesToUserRequestPayload({
      styleQuery: toolUseBlock.input.styleQuery,
    });
  }

  override getMetadata():
    | {
        images: ImageWithWidthAndHeight[];
      }
    | undefined {
    // Filter out images that don't have a width and height (THIS WAS BREAKING THE TOOL AND THE ENTIRE LIST CHAT WITH IT)
    if (!this.metadata) {
      return undefined;
    }

    return {
      images: this.metadata.images.filter(image => image.width && image.height),
    };
  }

  override createRequestInput(): ToolFunctionInputType<'suggest_styles_to_user'> {
    return {
      styleQuery: this.styleQuery,
    };
  }
}

export class SuggestStylesToUserResponsePayload extends BaseToolUsageResponsePayload {
  public imagePreferences: ImagePreferenceItemWithStyle[];

  constructor({ imagePreferences }: { imagePreferences: ImagePreferenceItemWithStyle[] }) {
    super('suggest_styles_to_user');
    this.imagePreferences = imagePreferences;
  }

  public override toToolResultBlock(toolId: string): ToolResultBlockParam {
    const likedProducts = this.imagePreferences.filter(
      p => p.imagePreferenceItem?.preferenceType === PreferenceType.LIKE,
    );

    let content = '';

    if (likedProducts.length > 0) {
      content += `# I liked these styles:\n`;
      likedProducts.forEach((p, index) => {
        content += `${index + 1}. ${p.style}\n`;
      });
    }

    return {
      tool_use_id: toolId,
      type: 'tool_result',
      content: content.trim(),
      is_error: false,
    };
  }

  static convertResultPayloadToToolResultBlock(
    payload: SuggestStylesToUserResponsePayload,
    id: string,
  ): ToolResultBlockParam {
    return payload.toToolResultBlock(id);
  }

  public addImagePreferences(imagePreferences: ImagePreferenceItemWithStyle[]): void {
    this.imagePreferences.push(...imagePreferences);
  }
}

export const SuggestStylesToUserTool = {
  requestClass: SuggestStylesToUserRequestPayload,
  responseClass: SuggestStylesToUserResponsePayload,
  functionSchema: {
    name: 'suggest_styles_to_user',
    description:
      'Suggest different styles of products for the user. You will give a single style query to search for the products (used on Pinterest)',
    input: z.object({
      styleQuery: z.string().describe('The style query to search for'),
    }),
  },
};
