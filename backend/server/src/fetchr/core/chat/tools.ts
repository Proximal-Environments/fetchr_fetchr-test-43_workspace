import { ErrorTool, ExecutingNonBlockingTool, ExecutingOutsideTool } from './tools/common_tools';
import { FinishFindingProductTool } from './tools/explore/finish_finding_product_tool';
import { MessageUserTool } from './tools/explore/message_user_tool';
import { PostFilterProductsTool } from './tools/explore/post_filter_products_tool';
import { SuggestProductsToUserTool } from './tools/explore/suggest_products_to_user_tool';
import { ViewProductImageTool } from './tools/explore/view_product_image_tool';
import { ExtractProductCopyTool } from './tools/orderManagement/extract_product_copy_tool';
import { SendStylistSuggestionsTool } from './tools/orderManagement/send_stylist_suggestions_tool';
import { GenerateTitleTool } from './tools/explore/generate_title_tool';
import { ExploreDifferentStylesTool } from './tools/explore/explore_different_styles_tool';
import { FilterProductTool } from './tools/explore/filter_product_tool';
import { SuggestStylesToUserTool } from './tools/explore/suggest_styles_to_user_tool';
import { PlaceOrderTool } from './tools/explore/place_order_tool';
import { FindProductsTool } from './tools/discovery/find_products_tool';
import { PresentProductsTool } from './tools/discovery/present_products_tool';

export const TOOLS_DICT = {
  // Discovery Agent
  find_products: FindProductsTool,
  present_products: PresentProductsTool,
  // Explore Agent
  view_product_image: ViewProductImageTool,
  message_user: MessageUserTool,
  suggest_products_to_user: SuggestProductsToUserTool,
  suggest_styles_to_user: SuggestStylesToUserTool,
  post_filter_products: PostFilterProductsTool,
  finish_finding_product: FinishFindingProductTool,
  // Explore
  generate_title: GenerateTitleTool, // Extraction

  // Order Management
  send_stylist_suggestions: SendStylistSuggestionsTool,
  extract_product_copy: ExtractProductCopyTool, // Extraction
  explore_different_styles: ExploreDifferentStylesTool,
  filter_product: FilterProductTool,

  // Place Order
  place_order: PlaceOrderTool,
  executing_non_blocking: ExecutingNonBlockingTool,
} as const;

export const COMMON_RESPONSE_TOOLS = {
  executing_outside: ExecutingOutsideTool,
  error: ErrorTool,
};
