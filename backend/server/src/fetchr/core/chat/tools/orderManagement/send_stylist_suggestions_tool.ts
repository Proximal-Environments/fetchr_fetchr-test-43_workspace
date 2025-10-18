import { z } from 'zod';
import { BaseToolUsageRequestPayload, BaseToolUsageResponsePayload } from '../../baseToolPayloads';
import { ToolFunctionInputType } from '../../types';
import { ToolResultBlockParam, ToolUseBlockParam } from '@anthropic-ai/sdk/resources';

interface SuggestionReasoning {
  productReasoning: string;
  brandReasoning: string;
  sizeReasoning: string;
}

interface MainStylistSuggestion {
  productId: string;
  recommendedSize: string;
  suggestionReasoning: SuggestionReasoning;
  currentPrice: number;
  originalPrice?: number;
  productCopy: string;
  userRequirements: string[];
}

interface SecondaryStylistSuggestion {
  productId: string;
  currentPrice: number;
  originalPrice?: number;
  userRequirements?: string[];
}

export class SendStylistSuggestionsRequestPayload extends BaseToolUsageRequestPayload {
  public mainSuggestion: MainStylistSuggestion;
  public secondarySuggestions: SecondaryStylistSuggestion[];

  constructor(input: ToolFunctionInputType<'send_stylist_suggestions'>) {
    super('send_stylist_suggestions');
    const { mainSuggestion, secondarySuggestions } = input;
    this.mainSuggestion = mainSuggestion;
    this.secondarySuggestions = secondarySuggestions;
  }

  static override fromToolUseBlock(
    toolUseBlock: ToolUseBlockParam & { input: ToolFunctionInputType<'send_stylist_suggestions'> },
  ): SendStylistSuggestionsRequestPayload {
    return new SendStylistSuggestionsRequestPayload({
      mainSuggestion: toolUseBlock.input.mainSuggestion,
      secondarySuggestions: toolUseBlock.input.secondarySuggestions,
    });
  }

  override createRequestInput(): ToolFunctionInputType<'send_stylist_suggestions'> {
    return {
      mainSuggestion: this.mainSuggestion,
      secondarySuggestions: this.secondarySuggestions.map(suggestion => ({
        ...suggestion,
        userRequirements: suggestion.userRequirements || [],
      })),
    };
  }
}

export class SendStylistSuggestionsResponsePayload extends BaseToolUsageResponsePayload {
  public modificationRequest?: string;
  public acceptedProduct?: {
    productId: string;
    size: string;
  };
  public toolUseId: string;

  constructor(response: {
    modificationRequest?: string;
    acceptedProduct?: {
      productId: string;
      size: string;
    };
    toolUseId: string;
  }) {
    super('send_stylist_suggestions');
    this.modificationRequest = response.modificationRequest;
    this.acceptedProduct = response.acceptedProduct;
    this.toolUseId = response.toolUseId;
  }

  override toToolResultBlock(toolId: string): ToolResultBlockParam {
    let content = '';

    if (this.modificationRequest) {
      content += `Modification Request: ${this.modificationRequest}\n`;
    }

    if (this.acceptedProduct) {
      content += `Accepted Product ID: ${this.acceptedProduct.productId}\n Size: ${this.acceptedProduct.size}\n`;
    }

    return {
      tool_use_id: toolId,
      type: 'tool_result',
      content: content.trim(),
      is_error: false,
    };
  }
}

export const SendStylistSuggestionsTool = {
  requestClass: SendStylistSuggestionsRequestPayload,
  responseClass: SendStylistSuggestionsResponsePayload,
  functionSchema: {
    name: 'send_stylist_suggestions',
    description: 'Send stylist-curated product suggestions to the user',
    input: z.object({
      mainSuggestion: z.object({
        productId: z.string().describe('The ID of the main product suggestion'),
        recommendedSize: z.string().describe('The recommended size for the main product'),
        suggestionReasoning: z.object({
          productReasoning: z.string().describe('Why this product is recommended'),
          brandReasoning: z.string().describe('Why this brand is recommended'),
          sizeReasoning: z.string().describe('Why this size is recommended'),
        }),
        currentPrice: z.number().describe('The current price of the main product'),
        originalPrice: z.number().describe('The original price of the main product').optional(),
        productCopy: z.string().describe('The copy to be shown to the user'),
        userRequirements: z
          .array(z.string())
          .describe(
            'The user requirements for the product. Include 1-6 (as many as was covered in the chat)',
          ),
      }),
      secondarySuggestions: z
        .array(
          z.object({
            productId: z.string().describe('The ID of the secondary product suggestion'),
            currentPrice: z.number().describe('The current price of the secondary product'),
            originalPrice: z
              .number()
              .describe('The original price of the secondary product')
              .optional(),
            userRequirements: z
              .array(z.string())
              .describe(
                'The user requirements for the product. Include 1-6 (as many as was covered in the chat)',
              ),
          }),
        )
        .length(2)
        .describe('Two alternative product suggestions'),
    }),
  },
};
