import {
  Gender,
  PreferenceType,
  ProductCategory,
  ProductFit,
  SearchMethod,
  SizeTop,
  UserRole,
  DiscoveryMethod,
  OrderStatus,
  StylistSuggestionStatus,
  AppEnvironment,
  ExploreRequestType,
  ShipmentStatus,
  ProductPurchaseFeedbackCategory,
  OrderSuggestionStatus,
  ProductPurchaseSuggestionStatus,
  OrderSuggestionDetailedStatus,
  RefundStatus,
  Platform,
  OrderType,
  PaymentStatus,
} from '@fetchr/schema/base/base';
import { CheckoutMode } from '@fetchr/schema/billing/billing';
import {
  gender as dbGender,
  product_category as dbCategory,
  fit as dbFit,
  style_swipe,
  tops_size as dbTopSize,
  discovery_methods as dbDiscoveryMethod,
  device_platform as dbDevicePlatform,
  order_lifecycle_status as dbOrderLifecycleStatus,
  explore_request_type as dbExploreRequestType,
  order_suggestion_status as dbOrderSuggestionStatus,
  shipment_status as dbShipmentStatus,
  product_purchase_feedback_category as dbProductPurchaseFeedbackCategory,
  product_purchase_suggestion_status as dbProductPurchaseSuggestionStatus,
  device_platform as dbPlatform,
  order_type as dbOrderType,
  payment_status as dbPaymentStatus,
  refund_status as dbRefundStatus,
  thread_type as dbThreadType,
  thread_status as dbThreadStatus,
} from '@prisma/client';

import { MessageRole, VoyageEmbeddingModel } from '@fetchr/schema/core/core';
import { DevicePlatform } from '@fetchr/schema/notifications/notifications';
import { ThreadStatus, ThreadType } from '@fetchr/schema/base/comments';
import { WhatBringsYouToFetchr } from '@fetchr/schema/base/base';
import { PaymentMethodStatus } from '@fetchr/schema/base/user_billing';

export function convertDbGenderToGender(gender: dbGender): Gender {
  if (gender === 'FEMALE') {
    return Gender.GENDER_FEMALE;
  } else if (gender === 'MALE') {
    return Gender.GENDER_MALE;
  } else if (gender === 'UNISEX') {
    return Gender.GENDER_UNISEX;
  } else if (gender === 'UNSPECIFIED') {
    return Gender.GENDER_UNSPECIFIED;
  }
  throw new Error(`Invalid gender: ${gender}`);
}

export function convertGenderToDbGender(gender: Gender): dbGender {
  if (gender === Gender.GENDER_FEMALE) {
    return 'FEMALE';
  } else if (gender === Gender.GENDER_MALE) {
    return 'MALE';
  } else if (gender === Gender.GENDER_UNISEX) {
    return 'UNISEX';
  } else if (gender === Gender.GENDER_UNSPECIFIED) {
    return 'UNSPECIFIED';
  }
  throw new Error(`Invalid gender: ${gender}`);
}

export function convertDbCategoryToCategory(category: dbCategory): ProductCategory {
  switch (category.toUpperCase()) {
    case 'TOPS':
      return ProductCategory.PRODUCT_CATEGORY_TOPS;
    case 'BOTTOMS':
      return ProductCategory.PRODUCT_CATEGORY_BOTTOMS;
    case 'ACCESSORIES':
      return ProductCategory.PRODUCT_CATEGORY_ACCESSORIES;
    case 'SHOES':
      return ProductCategory.PRODUCT_CATEGORY_SHOES;
    case 'DRESSES':
      return ProductCategory.PRODUCT_CATEGORY_DRESSES;
    case 'UNDERWEAR':
      return ProductCategory.PRODUCT_CATEGORY_UNDERWEAR;
    case 'OTHER':
      return ProductCategory.PRODUCT_CATEGORY_OTHER;
    default:
      throw new Error(`Invalid category: ${category}`);
  }
}

export function convertCategoryToDbCategory(category: ProductCategory): dbCategory {
  switch (category) {
    case ProductCategory.PRODUCT_CATEGORY_TOPS:
      return 'TOPS';
    case ProductCategory.PRODUCT_CATEGORY_BOTTOMS:
      return 'BOTTOMS';
    case ProductCategory.PRODUCT_CATEGORY_ACCESSORIES:
      return 'ACCESSORIES';
    case ProductCategory.PRODUCT_CATEGORY_SHOES:
      return 'SHOES';
    case ProductCategory.PRODUCT_CATEGORY_DRESSES:
      return 'DRESSES';
    case ProductCategory.PRODUCT_CATEGORY_UNDERWEAR:
      return 'UNDERWEAR';
    case ProductCategory.PRODUCT_CATEGORY_OTHER:
      return 'OTHER';
    default:
      throw new Error(`Invalid category: ${category}`);
  }
}

export function convertDbFitToFit(fit: dbFit): ProductFit {
  switch (fit) {
    case 'SLIM':
      return ProductFit.PRODUCT_FIT_SLIM;
    case 'REGULAR':
      return ProductFit.PRODUCT_FIT_REGULAR;
    case 'LOOSE':
      return ProductFit.PRODUCT_FIT_LOOSE;
    case 'RELAXED':
      return ProductFit.PRODUCT_FIT_RELAXED;
    case 'OVERSIZED':
      return ProductFit.PRODUCT_FIT_OVERSIZED;
    case 'ATHLETIC':
      return ProductFit.PRODUCT_FIT_ATHLETIC;
    case 'TAILORED':
      return ProductFit.PRODUCT_FIT_TAILORED;
    case 'BAGGY':
      return ProductFit.PRODUCT_FIT_BAGGY;
    case 'CROPPED':
      return ProductFit.PRODUCT_FIT_CROPPED;
    default:
      throw new Error(`Invalid fit: ${fit}`);
  }
}

export function convertFitToDbFit(fit: ProductFit): dbFit {
  switch (fit) {
    case ProductFit.PRODUCT_FIT_SLIM:
      return 'SLIM';
    case ProductFit.PRODUCT_FIT_REGULAR:
      return 'REGULAR';
    case ProductFit.PRODUCT_FIT_LOOSE:
      return 'LOOSE';
    case ProductFit.PRODUCT_FIT_RELAXED:
      return 'RELAXED';
    case ProductFit.PRODUCT_FIT_OVERSIZED:
      return 'OVERSIZED';
    case ProductFit.PRODUCT_FIT_ATHLETIC:
      return 'ATHLETIC';
    case ProductFit.PRODUCT_FIT_TAILORED:
      return 'TAILORED';
    case ProductFit.PRODUCT_FIT_BAGGY:
      return 'BAGGY';
    case ProductFit.PRODUCT_FIT_CROPPED:
      return 'CROPPED';
    default:
      throw new Error(`Invalid fit: ${fit}`);
  }
}

export function convertDbPreferenceTypeToPreferenceType(
  preferenceType: style_swipe,
): PreferenceType | undefined {
  if (!preferenceType) return undefined;

  const type = preferenceType.toLowerCase();
  if (['like', 'accepted', 'yes', 'true'].includes(type)) {
    return PreferenceType.LIKE;
  } else if (['dislike', 'rejected', 'no', 'false'].includes(type)) {
    return PreferenceType.DISLIKE;
  } else if (['superlike', 'super-like', 'super_like'].includes(type)) {
    return PreferenceType.SUPERLIKE;
  } else if (['maybe'].includes(type)) {
    return PreferenceType.MAYBE;
  }
  throw new Error(`Invalid preference type: ${preferenceType}`);
}

export function convertPreferenceTypeToDbPreferenceType(
  preferenceType: PreferenceType,
): style_swipe {
  switch (preferenceType) {
    case PreferenceType.LIKE:
      return 'LIKE';
    case PreferenceType.DISLIKE:
      return 'DISLIKE';
    case PreferenceType.SUPERLIKE:
      return 'SUPERLIKE';
    case PreferenceType.MAYBE:
      return 'MAYBE';
    default:
      throw new Error(`Invalid preference type: ${preferenceType}`);
  }
}

export function convertSearchMethodToSearchMethodString(
  searchMethod: SearchMethod,
):
  | 'image'
  | 'text'
  | 'voyage_text'
  | 'image_text_average'
  | 'voyage_multimodal'
  | 'voyage_text_siglip_image'
  | 'voyage_text_siglip_image_average'
  | 'voyage_text_siglip_image_average_sparse'
  | 'voyage_text_siglip_image_average_sparse_clean'
  | 'voyage_text_siglip_image_average_sparse_clean_with_semantic_metadata' {
  switch (searchMethod) {
    case SearchMethod.SEARCH_METHOD_IMAGE:
      return 'image';
    case SearchMethod.SEARCH_METHOD_TEXT:
      return 'text';
    case SearchMethod.SEARCH_METHOD_VOYAGE_TEXT:
      return 'voyage_text';
    case SearchMethod.SEARCH_METHOD_IMAGE_TEXT_AVERAGE:
      return 'image_text_average';
    case SearchMethod.SEARCH_METHOD_VOYAGE_MULTIMODAL:
      return 'voyage_multimodal';
    case SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE:
      return 'voyage_text_siglip_image';
    case SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE_AVERAGE:
      return 'voyage_text_siglip_image_average';
    case SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE_AVERAGE_SPARSE:
      return 'voyage_text_siglip_image_average_sparse';
    case SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE_AVERAGE_SPARSE_CLEAN:
      return 'voyage_text_siglip_image_average_sparse_clean';
    case SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE_AVERAGE_SPARSE_CLEAN_WITH_SEMANTIC_METADATA:
      return 'voyage_text_siglip_image_average_sparse_clean_with_semantic_metadata';
    case SearchMethod.SEARCH_METHOD_UNSPECIFIED:
      throw new Error('Invalid search method: UNSPECIFIED');
    default:
      throw new Error(`Invalid search method: ${searchMethod}`);
  }
}

export function convertSearchMethodStringToSearchMethod(
  searchMethod:
    | 'image'
    | 'text'
    | 'voyage_text'
    | 'image_text_average'
    | 'voyage_multimodal'
    | 'voyage_text_siglip_image'
    | 'voyage_text_siglip_image_average'
    | 'voyage_text_siglip_image_average_sparse'
    | 'voyage_text_siglip_image_average_sparse_clean'
    | 'voyage_text_siglip_image_average_sparse_clean_no_image'
    | 'voyage_text_siglip_image_average_sparse_clean_with_semantic_metadata',
): SearchMethod {
  switch (searchMethod) {
    case 'image':
      return SearchMethod.SEARCH_METHOD_IMAGE;
    case 'text':
      return SearchMethod.SEARCH_METHOD_TEXT;
    case 'voyage_text':
      return SearchMethod.SEARCH_METHOD_VOYAGE_TEXT;
    case 'image_text_average':
      return SearchMethod.SEARCH_METHOD_IMAGE_TEXT_AVERAGE;
    case 'voyage_multimodal':
      return SearchMethod.SEARCH_METHOD_VOYAGE_MULTIMODAL;
    case 'voyage_text_siglip_image':
      return SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE;
    case 'voyage_text_siglip_image_average':
      return SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE_AVERAGE;
    case 'voyage_text_siglip_image_average_sparse':
      return SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE_AVERAGE_SPARSE;
    case 'voyage_text_siglip_image_average_sparse_clean':
      return SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE_AVERAGE_SPARSE_CLEAN;
    case 'voyage_text_siglip_image_average_sparse_clean_with_semantic_metadata':
      return SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE_AVERAGE_SPARSE_CLEAN_WITH_SEMANTIC_METADATA;
    default:
      throw new Error(`Invalid search method: ${searchMethod}`);
  }
}

// export function convertDbShoeSizeToShoeSize(shoeSize: dbShoeSize): SizeShoes {
//   switch (shoeSize) {
//     case 'FIVE':
//       return SizeShoes.SIZE_SHOES_XS;
//     case 'SIX':
//       return SizeShoes.SIZE_SHOES_S;
//     default:
//       throw new Error(`Invalid shoe size: ${shoeSize}`);
//   }
// }

export function convertDbTopsSizeToSizeTop(topSize: dbTopSize): SizeTop {
  switch (topSize) {
    case 'XS':
      return SizeTop.SIZE_TOP_XS;
    case 'S':
      return SizeTop.SIZE_TOP_S;
    case 'M':
      return SizeTop.SIZE_TOP_M;
    case 'L':
      return SizeTop.SIZE_TOP_L;
    case 'XL':
      return SizeTop.SIZE_TOP_XL;
    case 'XXL':
      return SizeTop.SIZE_TOP_XXL;
    default:
      throw new Error(`Invalid top size: ${topSize}`);
  }
}

// export function convertDbDressSizeToSizeDress(dressSize: dbDressSize): SizeDress {
//   switch (dressSize) {
//     case 'ZERO':
//       return SizeDress.SIZE_DRESS_XS;
//     case 'ONE':
//       return SizeDress.SIZE_DRESS_S;
//     default:
//       throw new Error(`Invalid dress size: ${dressSize}`);
//   }
// }

// export function convertDressSizeToDbDressSize(dressSize: SizeDress): dbDressSize {
//   switch (dressSize) {
//     case SizeDress.SIZE_DRESS_XS:
//       return 'ZERO';
//     case SizeDress.SIZE_DRESS_S:
//       return 'ONE';
//     default:
//       throw new Error(`Invalid dress size: ${dressSize}`);
//   }
// }

// export function convertShoeSizeToDbShoeSize(shoeSize: SizeShoes): dbShoeSize {
//   switch (shoeSize) {
//     case SizeShoes.SIZE_SHOES_XS:
//       return 'FIVE';
//     case SizeShoes.SIZE_SHOES_S:
//       return 'SIX';
//     default:
//       throw new Error(`Invalid shoe size: ${shoeSize}`);
//   }
// }

export function convertTopSizeToDbTopSize(topSize: SizeTop): dbTopSize {
  switch (topSize) {
    case SizeTop.SIZE_TOP_XS:
      return 'XS';
    case SizeTop.SIZE_TOP_S:
      return 'S';
    case SizeTop.SIZE_TOP_M:
      return 'M';
    case SizeTop.SIZE_TOP_L:
      return 'L';
    case SizeTop.SIZE_TOP_XL:
      return 'XL';
    case SizeTop.SIZE_TOP_XXL:
      return 'XXL';
    default:
      throw new Error(`Invalid top size: ${topSize}`);
  }
}

export function convertDiscoveryMethodToDbDiscoveryMethod(
  discoveryMethod: DiscoveryMethod,
): dbDiscoveryMethod {
  switch (discoveryMethod) {
    case DiscoveryMethod.TWITTER:
      return 'TWITTER';
    case DiscoveryMethod.INSTAGRAM:
      return 'INSTAGRAM';
    case DiscoveryMethod.APP_STORE:
      return 'APP_STORE';
    case DiscoveryMethod.FRIENDS:
      return 'FRIENDS';
    case DiscoveryMethod.WEB_SEARCH:
      return 'WEB_SEARCH';
    case DiscoveryMethod.OTHER:
      return 'OTHER';
    default:
      throw new Error(`Invalid discovery method: ${discoveryMethod}`);
  }
}

export function convertRoleOrDbRoleToDbRole(
  role: MessageRole | 'user' | 'assistant' | 'system',
): 'user' | 'assistant' | 'system' {
  switch (role) {
    case MessageRole.MESSAGE_ROLE_USER:
      return 'user';
    case MessageRole.MESSAGE_ROLE_ASSISTANT:
      return 'assistant';
    case MessageRole.MESSAGE_ROLE_SYSTEM:
      return 'system';
    case 'user':
      return 'user';
    case 'assistant':
      return 'assistant';
    case 'system':
      return 'system';
    default:
      throw new Error(`Invalid message role: ${role}`);
  }
}

export function convertDbRoleToRole(role: string): MessageRole {
  switch (role) {
    case 'user':
      return MessageRole.MESSAGE_ROLE_USER;
    case 'assistant':
      return MessageRole.MESSAGE_ROLE_ASSISTANT;
    case 'system':
      return MessageRole.MESSAGE_ROLE_SYSTEM;
    default:
      throw new Error(`Invalid db role: ${role}`);
  }
}

export function convertDbRoleToUserRole(role?: string): UserRole {
  switch (role?.toUpperCase()) {
    case undefined:
      return UserRole.USER_ROLE_CUSTOMER;
    case 'CUSTOMER':
      return UserRole.USER_ROLE_CUSTOMER;
    case 'STYLIST':
      return UserRole.USER_ROLE_STYLIST;
    case 'ADMIN':
      return UserRole.USER_ROLE_ADMIN;
    case 'SUPER_STYLIST':
      return UserRole.USER_ROLE_SUPER_STYLIST;
    default:
      throw new Error(`Invalid role: ${role}`);
  }
}

export function convertUserRoleToDbRole(role: UserRole): string {
  switch (role) {
    case UserRole.USER_ROLE_CUSTOMER:
      return 'CUSTOMER';
    case UserRole.USER_ROLE_STYLIST:
      return 'STYLIST';
    case UserRole.USER_ROLE_ADMIN:
      return 'ADMIN';
    case UserRole.USER_ROLE_SUPER_STYLIST:
      return 'SUPER_STYLIST';
    default:
      throw new Error(`Invalid role: ${role}`);
  }
}

export function convertCheckoutModeToString(mode: CheckoutMode): 'redirect' | 'embedded' {
  switch (mode) {
    case CheckoutMode.CHECKOUT_MODE_REDIRECT:
      return 'redirect';
    case CheckoutMode.CHECKOUT_MODE_EMBEDDED:
      return 'embedded';
    case CheckoutMode.CHECKOUT_MODE_UNSPECIFIED:
      return 'redirect'; // default to redirect
    default:
      throw new Error(`Invalid checkout mode: ${mode}`);
  }
}

export function convertVoyageEmbeddingModelToDbVoyageEmbeddingModel(
  model: VoyageEmbeddingModel,
): string {
  switch (model) {
    case VoyageEmbeddingModel.VOYAGE_LARGE_3:
      return 'voyage-3-large';
    default:
      throw new Error(`Invalid voyage embedding model: ${model}`);
  }
}

export function convertOrderStatusToDbOrderStatus(status: OrderStatus): dbOrderLifecycleStatus {
  switch (status) {
    case OrderStatus.ORDER_STATUS_UNSPECIFIED:
      return 'initiated';
    case OrderStatus.ORDER_STATUS_INITIATED:
      return 'initiated';
    case OrderStatus.ORDER_STATUS_WAITING_FOR_STYLIST:
      return 'waiting_for_stylist';
    case OrderStatus.ORDER_STATUS_WAITING_FOR_USER_FEEDBACK:
      return 'waiting_for_user_feedback';
    case OrderStatus.ORDER_STATUS_TO_BE_PURCHASED:
      return 'to_be_purchased';
    case OrderStatus.ORDER_STATUS_PURCHASED:
      return 'purchased';
    case OrderStatus.ORDER_STATUS_SHIPPING_IN_TRANSIT:
      return 'shipping_in_transit';
    case OrderStatus.ORDER_STATUS_DELIVERED:
      return 'delivered';
    case OrderStatus.ORDER_STATUS_CANCELLED:
      return 'cancelled';
    case OrderStatus.ORDER_STATUS_REFUNDED:
      return 'refunded';
    case OrderStatus.UNRECOGNIZED:
      throw new Error('Invalid order status: UNRECOGNIZED');
    default:
      throw new Error(`Invalid order status: ${status}`);
  }
}

export function convertOrderStatusToDashboardStatus(status: OrderStatus): string {
  switch (status) {
    case OrderStatus.ORDER_STATUS_UNSPECIFIED:
      return 'initiated';
    case OrderStatus.ORDER_STATUS_INITIATED:
      return 'Ready for Stylist (New Order)';
    case OrderStatus.ORDER_STATUS_WAITING_FOR_STYLIST:
      return 'Ready for Stylist (Asked for modification)';
    case OrderStatus.ORDER_STATUS_WAITING_FOR_USER_FEEDBACK:
      return 'Order Sent to User';
    case OrderStatus.ORDER_STATUS_TO_BE_PURCHASED:
      return 'Need to purchase';
    case OrderStatus.ORDER_STATUS_PURCHASED:
      return 'Purchased';
    case OrderStatus.ORDER_STATUS_SHIPPING_IN_TRANSIT:
      return 'Shipping';
    case OrderStatus.ORDER_STATUS_DELIVERED:
      return 'Delivered';
    case OrderStatus.ORDER_STATUS_CANCELLED:
      return 'Cancelled';
    case OrderStatus.ORDER_STATUS_REFUNDED:
      return 'Refunded';
    case OrderStatus.UNRECOGNIZED:
      throw new Error('Invalid order status: UNRECOGNIZED');
    default:
      throw new Error(`Invalid order status: ${status}`);
  }
}

export function convertDbOrderTypeToProtoOrderType(
  dbType: string | null | undefined,
): OrderType | undefined {
  if (!dbType) return undefined;
  switch (dbType) {
    case 'user_initiated':
      return OrderType.ORDER_TYPE_USER_INITIATED;
    case 'fetchr_initiated':
      return OrderType.ORDER_TYPE_FETCHR_INITIATED;
    default:
      return OrderType.UNRECOGNIZED;
  }
}

export function convertProtoOrderTypeToDbOrderType(
  orderType: OrderType | undefined,
): dbOrderType | undefined {
  if (orderType === undefined) return undefined;
  switch (orderType) {
    case OrderType.ORDER_TYPE_USER_INITIATED:
      return 'user_initiated';
    case OrderType.ORDER_TYPE_FETCHR_INITIATED:
      return 'fetchr_initiated';
    case OrderType.UNRECOGNIZED:
    default:
      return undefined;
  }
}

export function convertOrderStatusToUserSideString(status: OrderStatus): string | null {
  switch (status) {
    case OrderStatus.ORDER_STATUS_INITIATED:
      return 'Processing';
    case OrderStatus.ORDER_STATUS_WAITING_FOR_STYLIST:
      return 'Processing';
    case OrderStatus.ORDER_STATUS_WAITING_FOR_USER_FEEDBACK:
      return 'Processing';
    case OrderStatus.ORDER_STATUS_TO_BE_PURCHASED:
      return 'Purchased';
    case OrderStatus.ORDER_STATUS_PURCHASED:
      return 'Purchased';
    case OrderStatus.ORDER_STATUS_SHIPPING_IN_TRANSIT:
      return 'Shipping';
    case OrderStatus.ORDER_STATUS_DELIVERED:
      return 'Delivered';
    case OrderStatus.ORDER_STATUS_CANCELLED:
      return 'Cancelled';
    case OrderStatus.ORDER_STATUS_REFUNDED:
      return 'Refunded';
    case OrderStatus.UNRECOGNIZED:
      throw new Error('Invalid order status: UNRECOGNIZED');
    default:
      throw new Error(`Invalid order status: ${status}`);
  }
}

export function convertOrderStatusToString(status: OrderStatus): string {
  switch (status) {
    case OrderStatus.ORDER_STATUS_INITIATED:
      return 'Pending';
    case OrderStatus.ORDER_STATUS_WAITING_FOR_STYLIST:
      return 'Pending';
    case OrderStatus.ORDER_STATUS_WAITING_FOR_USER_FEEDBACK:
      return 'Ready';
    case OrderStatus.ORDER_STATUS_TO_BE_PURCHASED:
      return 'Ready';
    case OrderStatus.ORDER_STATUS_PURCHASED:
      return 'Purchased';
    case OrderStatus.ORDER_STATUS_SHIPPING_IN_TRANSIT:
      return 'Shipping';
    case OrderStatus.ORDER_STATUS_DELIVERED:
      return 'Delivered';
    case OrderStatus.ORDER_STATUS_CANCELLED:
      return 'Cancelled';
    case OrderStatus.ORDER_STATUS_REFUNDED:
      return 'Refunded';
    case OrderStatus.UNRECOGNIZED:
      throw new Error('Invalid order status: UNRECOGNIZED');
    default:
      throw new Error(`Invalid order status: ${status}`);
  }
}

export function convertDbOrderStatusToOrderStatus(status: dbOrderLifecycleStatus): OrderStatus {
  switch (status) {
    case 'initiated':
      return OrderStatus.ORDER_STATUS_INITIATED;
    case 'waiting_for_stylist':
      return OrderStatus.ORDER_STATUS_WAITING_FOR_STYLIST;
    case 'waiting_for_user_feedback':
      return OrderStatus.ORDER_STATUS_WAITING_FOR_USER_FEEDBACK;
    case 'to_be_purchased':
      return OrderStatus.ORDER_STATUS_TO_BE_PURCHASED;
    case 'purchased':
      return OrderStatus.ORDER_STATUS_PURCHASED;
    case 'shipping_in_transit':
      return OrderStatus.ORDER_STATUS_SHIPPING_IN_TRANSIT;
    case 'delivered':
      return OrderStatus.ORDER_STATUS_DELIVERED;
    case 'cancelled':
      return OrderStatus.ORDER_STATUS_CANCELLED;
    case 'refunded':
      return OrderStatus.ORDER_STATUS_REFUNDED;
    default:
      throw new Error(`Invalid order status: ${status}`);
  }
}

export function convertDevicePlatformToDbDevicePlatform(
  platform: DevicePlatform,
): dbDevicePlatform {
  switch (platform) {
    case DevicePlatform.DEVICE_PLATFORM_IOS:
      return 'IOS';
    case DevicePlatform.DEVICE_PLATFORM_ANDROID:
      return 'ANDROID';
    case DevicePlatform.DEVICE_PLATFORM_WEB:
      return 'WEB';
    default:
      throw new Error(`Invalid device platform: ${platform}`);
  }
}

export function convertDbDevicePlatformToDevicePlatform(
  platform: dbDevicePlatform,
): DevicePlatform {
  switch (platform) {
    case 'IOS':
      return DevicePlatform.DEVICE_PLATFORM_IOS;
    case 'ANDROID':
      return DevicePlatform.DEVICE_PLATFORM_ANDROID;
    case 'WEB':
      return DevicePlatform.DEVICE_PLATFORM_WEB;
    default:
      throw new Error(`Invalid device platform: ${platform}`);
  }
}

export type ProductSizingHeader = {
  is_available: boolean;
  display_name: string;
  name: string;
  value: string;
};

export type ProductSizingOption = {
  is_available: boolean;
  display_name: string;
  name: string;
  value: string;
};

export type ProductSizing = {
  headers: ProductSizingHeader[];
  options: ProductSizingOption[];
};

export function convertProductSizingJsonToProductSizing(productSizing: string): ProductSizing {
  return JSON.parse(productSizing);
}

export function convertStylistSuggestionStatusToString(status: StylistSuggestionStatus): string {
  switch (status) {
    case StylistSuggestionStatus.STYLIST_SUGGESTION_STATUS_WAITING:
      return 'waiting';
    case StylistSuggestionStatus.STYLIST_SUGGESTION_STATUS_ACCEPTED:
      return 'accepted';
    case StylistSuggestionStatus.STYLIST_SUGGESTION_STATUS_MODIFICATION_REQUESTED:
      return 'modification_requested';
    default:
      throw new Error(`Invalid stylist suggestion status: ${status}`);
  }
}

export function convertStylistSuggestionStatusToDbStylistSuggestionStatus(
  status: StylistSuggestionStatus,
): string {
  switch (status) {
    case StylistSuggestionStatus.STYLIST_SUGGESTION_STATUS_WAITING:
      return 'waiting';
    case StylistSuggestionStatus.STYLIST_SUGGESTION_STATUS_ACCEPTED:
      return 'accepted';
    case StylistSuggestionStatus.STYLIST_SUGGESTION_STATUS_MODIFICATION_REQUESTED:
      return 'modification_requested';
    default:
      throw new Error(`Invalid stylist suggestion status: ${status}`);
  }
}

export function convertAppEnvironmentToString(environment: AppEnvironment): string {
  switch (environment) {
    case AppEnvironment.APP_ENVIRONMENT_DEV:
      return 'dev';
    case AppEnvironment.APP_ENVIRONMENT_TEST_FLIGHT:
      return 'test_flight';
    case AppEnvironment.APP_ENVIRONMENT_PROD:
      return 'prod';
    case AppEnvironment.APP_ENVIRONMENT_UNSPECIFIED:
      return 'unspecified';
    default:
      throw new Error(`Invalid app environment: ${environment}`);
  }
}

export function convertStringToAppEnvironment(environment: string): AppEnvironment {
  switch (environment) {
    case 'dev':
      return AppEnvironment.APP_ENVIRONMENT_DEV;
    case 'test_flight':
      return AppEnvironment.APP_ENVIRONMENT_TEST_FLIGHT;
    case 'prod':
      return AppEnvironment.APP_ENVIRONMENT_PROD;
    case 'unspecified':
      return AppEnvironment.APP_ENVIRONMENT_UNSPECIFIED;
    default:
      throw new Error(`Invalid app environment: ${environment}`);
  }
}

export function convertExploreRequestTypeToDbExploreRequestType(
  requestType: ExploreRequestType,
): dbExploreRequestType {
  switch (requestType) {
    case ExploreRequestType.EXPLORE_REQUEST_TYPE_OUTFIT:
      return 'outfit_request';
    case ExploreRequestType.EXPLORE_REQUEST_TYPE_ITEM:
      return 'item_request';
    default:
      throw new Error(`Invalid explore request type: ${requestType}`);
  }
}

export function convertDbExploreRequestTypeToExploreRequestType(
  requestType: dbExploreRequestType,
): ExploreRequestType {
  switch (requestType) {
    case 'outfit_request':
      return ExploreRequestType.EXPLORE_REQUEST_TYPE_OUTFIT;
    case 'item_request':
      return ExploreRequestType.EXPLORE_REQUEST_TYPE_ITEM;
    default:
      throw new Error(`Invalid explore request type: ${requestType}`);
  }
}

export function convertDbShipmentStatusToShipmentStatus(status: dbShipmentStatus): ShipmentStatus {
  switch (status) {
    case 'Pending_Shipping':
      return ShipmentStatus.SHIPMENT_STATUS_PENDING_SHIPPING;
    case 'Shipping':
      return ShipmentStatus.SHIPMENT_STATUS_SHIPPING;
    case 'Delivered':
      return ShipmentStatus.SHIPMENT_STATUS_DELIVERED;
    case 'Cancelled_By_Store':
      return ShipmentStatus.SHIPMENT_STATUS_CANCELLED_BY_STORE;
    default:
      throw new Error(`Invalid shipment status: ${status}`);
  }
}
export function convertDbProductPurchaseFeedbackCategoryToProductPurchaseFeedbackCategory(
  category: dbProductPurchaseFeedbackCategory,
): ProductPurchaseFeedbackCategory {
  switch (category) {
    case 'fit_sizing':
      return ProductPurchaseFeedbackCategory.PRODUCT_PURCHASE_FEEDBACK_CATEGORY_FIT_SIZING;
    case 'style_color':
      return ProductPurchaseFeedbackCategory.PRODUCT_PURCHASE_FEEDBACK_CATEGORY_STYLE_COLOR;
    case 'quality_issue':
      return ProductPurchaseFeedbackCategory.PRODUCT_PURCHASE_FEEDBACK_CATEGORY_QUALITY_ISSUE;
    case 'damaged_defective':
      return ProductPurchaseFeedbackCategory.PRODUCT_PURCHASE_FEEDBACK_CATEGORY_DAMAGED_DEFECTIVE;
    case 'no_longer_needed':
      return ProductPurchaseFeedbackCategory.PRODUCT_PURCHASE_FEEDBACK_CATEGORY_NO_LONGER_NEEDED;
    // bad other
    case 'other':
      return ProductPurchaseFeedbackCategory.PRODUCT_PURCHASE_FEEDBACK_CATEGORY_OTHER;
    case 'good_fit':
      return ProductPurchaseFeedbackCategory.PRODUCT_PURCHASE_FEEDBACK_CATEGORY_GOOD_FIT;
    case 'good_color':
      return ProductPurchaseFeedbackCategory.PRODUCT_PURCHASE_FEEDBACK_CATEGORY_GOOD_COLOR;
    case 'high_quality_fabric':
      return ProductPurchaseFeedbackCategory.PRODUCT_PURCHASE_FEEDBACK_CATEGORY_HIGH_QUALITY_FABRIC;
    case 'good_value':
      return ProductPurchaseFeedbackCategory.PRODUCT_PURCHASE_FEEDBACK_CATEGORY_GOOD_VALUE;
    case 'matches_wardrobe':
      return ProductPurchaseFeedbackCategory.PRODUCT_PURCHASE_FEEDBACK_CATEGORY_MATCHES_WARDROBE;
    case 'like_brand':
      return ProductPurchaseFeedbackCategory.PRODUCT_PURCHASE_FEEDBACK_CATEGORY_LIKE_BRAND;
    case 'good_other':
      return ProductPurchaseFeedbackCategory.PRODUCT_PURCHASE_FEEDBACK_CATEGORY_GOOD_OTHER;
    default:
      throw new Error(`Invalid product purchase feedback category: ${category}`);
  }
}

export function convertProductPurchaseFeedbackCategoryToDbProductPurchaseFeedbackCategory(
  category: ProductPurchaseFeedbackCategory,
): dbProductPurchaseFeedbackCategory {
  switch (category) {
    case ProductPurchaseFeedbackCategory.PRODUCT_PURCHASE_FEEDBACK_CATEGORY_FIT_SIZING:
      return 'fit_sizing';
    case ProductPurchaseFeedbackCategory.PRODUCT_PURCHASE_FEEDBACK_CATEGORY_STYLE_COLOR:
      return 'style_color';
    case ProductPurchaseFeedbackCategory.PRODUCT_PURCHASE_FEEDBACK_CATEGORY_QUALITY_ISSUE:
      return 'quality_issue';
    case ProductPurchaseFeedbackCategory.PRODUCT_PURCHASE_FEEDBACK_CATEGORY_DAMAGED_DEFECTIVE:
      return 'damaged_defective';
    case ProductPurchaseFeedbackCategory.PRODUCT_PURCHASE_FEEDBACK_CATEGORY_NO_LONGER_NEEDED:
      return 'no_longer_needed';
    // bad other
    case ProductPurchaseFeedbackCategory.PRODUCT_PURCHASE_FEEDBACK_CATEGORY_OTHER:
      return 'other';
    case ProductPurchaseFeedbackCategory.PRODUCT_PURCHASE_FEEDBACK_CATEGORY_GOOD_FIT:
      return 'good_fit';
    case ProductPurchaseFeedbackCategory.PRODUCT_PURCHASE_FEEDBACK_CATEGORY_GOOD_COLOR:
      return 'good_color';
    case ProductPurchaseFeedbackCategory.PRODUCT_PURCHASE_FEEDBACK_CATEGORY_HIGH_QUALITY_FABRIC:
      return 'high_quality_fabric';
    case ProductPurchaseFeedbackCategory.PRODUCT_PURCHASE_FEEDBACK_CATEGORY_GOOD_VALUE:
      return 'good_value';
    case ProductPurchaseFeedbackCategory.PRODUCT_PURCHASE_FEEDBACK_CATEGORY_MATCHES_WARDROBE:
      return 'matches_wardrobe';
    case ProductPurchaseFeedbackCategory.PRODUCT_PURCHASE_FEEDBACK_CATEGORY_LIKE_BRAND:
      return 'like_brand';
    case ProductPurchaseFeedbackCategory.PRODUCT_PURCHASE_FEEDBACK_CATEGORY_GOOD_OTHER:
      return 'good_other';
    default:
      throw new Error(`Invalid product purchase feedback category: ${category}`);
  }
}

export function convertDbOrderSuggestionStatusToOrderSuggestionStatus(
  status: dbOrderSuggestionStatus,
): OrderSuggestionStatus {
  switch (status) {
    case 'Pending':
      return OrderSuggestionStatus.ORDER_SUGGESTION_STATUS_PENDING;
    case 'Reviewed':
      return OrderSuggestionStatus.ORDER_SUGGESTION_STATUS_REVIEWED;
    default:
      throw new Error(`Invalid order suggestion status: ${status}`);
  }
}

export function convertShipmentStatusToDbShipmentStatus(status: ShipmentStatus): dbShipmentStatus {
  switch (status) {
    case ShipmentStatus.SHIPMENT_STATUS_PENDING_SHIPPING:
      return 'Pending_Shipping';
    case ShipmentStatus.SHIPMENT_STATUS_SHIPPING:
      return 'Shipping';
    case ShipmentStatus.SHIPMENT_STATUS_DELIVERED:
      return 'Delivered';
    case ShipmentStatus.SHIPMENT_STATUS_CANCELLED_BY_STORE:
      return 'Cancelled_By_Store';
    default:
      throw new Error(`Invalid shipment status: ${status}`);
  }
}

export const goodFeedbackCategories = [
  'good_fit',
  'good_color',
  'high_quality_fabric',
  'good_value',
  'matches_wardrobe',
  'like_brand',
  'good_other',
];

export const badFeedbackCategories = [
  'fit_sizing',
  'style_color',
  'quality_issue',
  'damaged_defective',
  'no_longer_needed',
  'other',
];

export function convertDbProductPurchaseSuggestionStatusToProductPurchaseSuggestionStatus(
  status: dbProductPurchaseSuggestionStatus,
): ProductPurchaseSuggestionStatus {
  switch (status) {
    case 'PENDING':
      return ProductPurchaseSuggestionStatus.PRODUCT_PURCHASE_SUGGESTION_STATUS_PENDING;
    case 'APPROVED':
      return ProductPurchaseSuggestionStatus.PRODUCT_PURCHASE_SUGGESTION_STATUS_ACCEPTED;
    case 'REJECTED':
      return ProductPurchaseSuggestionStatus.PRODUCT_PURCHASE_SUGGESTION_STATUS_REJECTED;
    default:
      throw new Error(`Invalid product purchase suggestion status: ${status}`);
  }
}

export function convertOrderSuggestionDetailedStatusToHumanReadable(
  status: OrderSuggestionDetailedStatus,
): string {
  switch (status) {
    case OrderSuggestionDetailedStatus.ORDER_SUGGESTION_DETAILED_STATUS_PENDING_VERIFICATION:
      return 'Pending Verification';
    case OrderSuggestionDetailedStatus.ORDER_SUGGESTION_DETAILED_STATUS_MODIFYING_ITEMS:
      return 'Modifying Items';
    case OrderSuggestionDetailedStatus.ORDER_SUGGESTION_DETAILED_STATUS_PENDING_PURCHASE:
      return 'Pending Purchase';
    case OrderSuggestionDetailedStatus.ORDER_SUGGESTION_DETAILED_STATUS_SHIPPING:
      return 'Shipping';
    case OrderSuggestionDetailedStatus.ORDER_SUGGESTION_DETAILED_STATUS_DELIVERED:
      return 'Delivered';
    case OrderSuggestionDetailedStatus.ORDER_SUGGESTION_DETAILED_STATUS_FINDING_ITEMS:
      return 'Finding Items';
    case OrderSuggestionDetailedStatus.UNRECOGNIZED:
      return 'Unrecognized';
    case OrderSuggestionDetailedStatus.ORDER_SUGGESTION_DETAILED_STATUS_UNSPECIFIED:
      return 'Unspecified';
    default:
      throw new Error(`Invalid order suggestion detailed status: ${status}`);
  }
}

export function convertDbProductPurchaseRefundStatusToProductPurchaseRefundStatus(
  refundStatus: string,
): RefundStatus {
  switch (refundStatus) {
    case 'pending_user_feedback':
      return RefundStatus.REFUND_STATUS_PENDING_USER_FEEDBACK;
    case 'deadline_expired':
      return RefundStatus.REFUND_STATUS_DEADLINE_EXPIRED;
    case 'item_kept':
      return RefundStatus.REFUND_STATUS_ITEM_KEPT;
    case 'requested':
      return RefundStatus.REFUND_STATUS_REQUESTED;
    case 'requested_item_picked_up':
      return RefundStatus.REFUND_STATUS_REQUESTED_ITEM_PICKED_UP;
    case 'requested_shipped_back':
      return RefundStatus.REFUND_STATUS_REQUESTED_SHIPPED_BACK;
    case 'requested_non_refundable_item':
      return RefundStatus.REFUND_STATUS_REQUESTED_NON_REFUNDABLE_ITEM;
    default:
      throw new Error(`Invalid refund status: ${refundStatus}`);
  }
}

export function convertProductPurchaseRefundStatusToDbProductPurchaseRefundStatus(
  refundStatus: RefundStatus,
): dbRefundStatus {
  switch (refundStatus) {
    case RefundStatus.REFUND_STATUS_PENDING_USER_FEEDBACK:
      return 'pending_user_feedback';
    case RefundStatus.REFUND_STATUS_DEADLINE_EXPIRED:
      return 'deadline_expired';
    case RefundStatus.REFUND_STATUS_REQUESTED:
      return 'requested';
    case RefundStatus.REFUND_STATUS_REQUESTED_ITEM_PICKED_UP:
      return 'requested_item_picked_up';
    case RefundStatus.REFUND_STATUS_REQUESTED_SHIPPED_BACK:
      return 'requested_shipped_back';
    case RefundStatus.REFUND_STATUS_REQUESTED_NON_REFUNDABLE_ITEM:
      return 'requested_non_refundable_item';
    case RefundStatus.REFUND_STATUS_ITEM_KEPT:
      return 'item_kept';
    default:
      throw new Error(`Invalid refund status: ${refundStatus}`);
  }
}

export function convertDbPlatformToPlatform(platform: dbPlatform): Platform {
  switch (platform) {
    case 'IOS':
      return Platform.PLATFORM_IOS;
    case 'ANDROID':
      return Platform.PLATFORM_ANDROID;
    case 'WEB':
      return Platform.PLATFORM_WEB;
    default:
      throw new Error(`Invalid platform: ${platform}`);
  }
}

export function convertPlatformToDbPlatform(platform: Platform): dbPlatform {
  switch (platform) {
    case Platform.PLATFORM_IOS:
      return 'IOS';
    case Platform.PLATFORM_ANDROID:
      return 'ANDROID';
    case Platform.PLATFORM_WEB:
      return 'WEB';
    default:
      throw new Error(`Invalid platform: ${platform}`);
  }
}

export function convertPaymentStatusToDbPaymentStatus(status: PaymentStatus): dbPaymentStatus {
  switch (status) {
    case PaymentStatus.PAYMENT_STATUS_NOT_PAID:
      return 'not_paid';
    case PaymentStatus.PAYMENT_STATUS_PAID:
      return 'paid';
    case PaymentStatus.PAYMENT_STATUS_PAYMENT_DENIED:
      return 'payment_denied';
    default:
      throw new Error(`Invalid payment status: ${status}`);
  }
}

export function convertDbPaymentStatusToPaymentStatus(status: dbPaymentStatus): PaymentStatus {
  switch (status) {
    case 'not_paid':
      return PaymentStatus.PAYMENT_STATUS_NOT_PAID;
    case 'paid':
      return PaymentStatus.PAYMENT_STATUS_PAID;
    case 'payment_denied':
      return PaymentStatus.PAYMENT_STATUS_PAYMENT_DENIED;
    default:
      throw new Error(`Invalid payment status: ${status}`);
  }
}

export function convertDbPaymentMethodStatusToPaymentMethodStatus(
  status: string | null,
): PaymentMethodStatus {
  switch (status) {
    case 'VALID':
      return PaymentMethodStatus.PAYMENT_METHOD_STATUS_VALID;
    case 'EXPIRED':
      return PaymentMethodStatus.PAYMENT_METHOD_STATUS_EXPIRED;
    case 'NO_PAYMENT_METHOD':
      return PaymentMethodStatus.PAYMENT_METHOD_STATUS_NO_PAYMENT_METHOD;
    case null:
      return PaymentMethodStatus.PAYMENT_METHOD_STATUS_NO_PAYMENT_METHOD;
    default:
      return PaymentMethodStatus.PAYMENT_METHOD_STATUS_UNSPECIFIED;
  }
}

export function convertPaymentMethodStatusToDbPaymentMethodStatus(
  status: PaymentMethodStatus,
): 'VALID' | 'EXPIRED' | 'NO_PAYMENT_METHOD' | null {
  switch (status) {
    case PaymentMethodStatus.PAYMENT_METHOD_STATUS_VALID:
      return 'VALID';
    case PaymentMethodStatus.PAYMENT_METHOD_STATUS_EXPIRED:
      return 'EXPIRED';
    case PaymentMethodStatus.PAYMENT_METHOD_STATUS_NO_PAYMENT_METHOD:
      return 'NO_PAYMENT_METHOD';
    default:
      return null;
  }
}

export function convertDbThreadTypeToThreadType(type: dbThreadType): ThreadType {
  switch (type) {
    case 'Comment':
      return ThreadType.THREAD_TYPE_COMMENT;
    case 'Warning':
      return ThreadType.THREAD_TYPE_WARNING;
    case 'Issue':
      return ThreadType.THREAD_TYPE_ISSUE;
    default:
      throw new Error(`Invalid thread type: ${type}`);
  }
}

export function convertThreadTypeToDbThreadType(type: ThreadType): dbThreadType {
  switch (type) {
    case ThreadType.THREAD_TYPE_COMMENT:
      return 'Comment';
    case ThreadType.THREAD_TYPE_WARNING:
      return 'Warning';
    case ThreadType.THREAD_TYPE_ISSUE:
      return 'Issue';
    default:
      throw new Error(`Invalid thread type: ${type}`);
  }
}

export function convertThreadStatusToDbThreadStatus(status: ThreadStatus): dbThreadStatus {
  switch (status) {
    case ThreadStatus.THREAD_STATUS_OPEN:
      return 'Open';
    case ThreadStatus.THREAD_STATUS_RESOLVED:
      return 'Resolved';
    case ThreadStatus.THREAD_STATUS_NOT_APPLICABLE:
      return 'Not_Applicable';
    default:
      throw new Error(`Invalid thread status: ${status}`);
  }
}

export function convertDbThreadStatusToThreadStatus(status: dbThreadStatus): ThreadStatus {
  switch (status) {
    case 'Open':
      return ThreadStatus.THREAD_STATUS_OPEN;
    case 'Resolved':
      return ThreadStatus.THREAD_STATUS_RESOLVED;
    case 'Not_Applicable':
      return ThreadStatus.THREAD_STATUS_NOT_APPLICABLE;
    default:
      throw new Error(`Invalid thread status: ${status}`);
  }
}

export function convertWhatBringsYouToFetchrToDbWhatBringsYouToFetchr(
  value: WhatBringsYouToFetchr | undefined | null,
): 'EXPLORE_STYLE' | 'WORK_WITH_STYLIST' | 'LOOKING_FOR_ITEM' | null {
  if (!value) return null;
  switch (value) {
    case WhatBringsYouToFetchr.WHAT_BRINGS_YOU_TO_FETCHR_EXPLORE_STYLE:
      return 'EXPLORE_STYLE';
    case WhatBringsYouToFetchr.WHAT_BRINGS_YOU_TO_FETCHR_WORK_WITH_STYLIST:
      return 'WORK_WITH_STYLIST';
    case WhatBringsYouToFetchr.WHAT_BRINGS_YOU_TO_FETCHR_LOOKING_FOR_ITEM:
      return 'LOOKING_FOR_ITEM';
    default:
      return null;
  }
}

export function convertDbWhatBringsYouToFetchrToWhatBringsYouToFetchr(
  value: 'EXPLORE_STYLE' | 'WORK_WITH_STYLIST' | 'LOOKING_FOR_ITEM' | null,
): WhatBringsYouToFetchr | undefined {
  if (!value) return undefined;
  switch (value) {
    case 'EXPLORE_STYLE':
      return WhatBringsYouToFetchr.WHAT_BRINGS_YOU_TO_FETCHR_EXPLORE_STYLE;
    case 'WORK_WITH_STYLIST':
      return WhatBringsYouToFetchr.WHAT_BRINGS_YOU_TO_FETCHR_WORK_WITH_STYLIST;
    case 'LOOKING_FOR_ITEM':
      return WhatBringsYouToFetchr.WHAT_BRINGS_YOU_TO_FETCHR_LOOKING_FOR_ITEM;
    default:
      return undefined;
  }
}
