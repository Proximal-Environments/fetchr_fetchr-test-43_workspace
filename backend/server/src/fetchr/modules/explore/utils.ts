import { ExploreRequest, ExploreRequestType, UserProfile } from '@fetchr/schema/base/base';
import { FetchrMessage } from '../../core/chat/chatHistory';
import {
  EXPLORE_AGENT_PRODUCT_LISTING_PROMPT,
  EXPLORE_AGENT_PROMPT_DEFAULT,
  EXPLORE_AGENT_PROMPT_OUTFIT,
  GENERATE_DETAILED_SEARCH_QUERIES_USER_PROMPT,
} from './explorePrompts';
import { convertGenderToDbGender } from '../../../shared/converters';
import { productService } from '../../base/service_injection/global';

export const getFirstTwoMessages = async (
  exploreRequest: ExploreRequest,
  userProfile: UserProfile,
): Promise<{ systemMessage: FetchrMessage; firstUserMessage: FetchrMessage }> => {
  if (!userProfile.metadata?.gender) {
    throw new Error('User profile gender is required');
  }

  const requestType = exploreRequest.requestType;
  let systemPrompt =
    requestType === ExploreRequestType.EXPLORE_REQUEST_TYPE_OUTFIT
      ? EXPLORE_AGENT_PROMPT_OUTFIT
      : EXPLORE_AGENT_PROMPT_DEFAULT;

  systemPrompt = systemPrompt.replace('{{user_location}}', userProfile.address?.city ?? 'unknown');
  let userPrompt = GENERATE_DETAILED_SEARCH_QUERIES_USER_PROMPT.replace(
    '{query}',
    exploreRequest.query,
  )
    .replace('{gender}', convertGenderToDbGender(userProfile.metadata?.gender))
    .replace('{bio}', userProfile.generatedProfileDescription?.description ?? '');

  if (exploreRequest.productId) {
    const product = await productService.getProductOrFail(exploreRequest.productId);
    const productDetails = product;
    userPrompt +=
      '\n\n' +
      EXPLORE_AGENT_PRODUCT_LISTING_PROMPT.replace(
        '{product}',
        `# Product: ${productDetails?.name} - ${productDetails?.brandName} ${
          productDetails?.subBrandName ? `(${productDetails?.subBrandName})` : ''
        }
${productDetails?.generatedDescription}
Details: ${productDetails?.details}
Colors: ${productDetails?.colors?.join(', ')}
Materials: ${productDetails?.materials?.join(', ')}
    `,
      );
  }
  return {
    systemMessage: {
      role: 'assistant',
      content: systemPrompt,
    },
    firstUserMessage: {
      role: 'user',
      content: userPrompt,
    },
  };
};
