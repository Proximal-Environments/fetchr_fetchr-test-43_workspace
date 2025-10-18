import {
  ExploreRequest,
  PreferenceType,
  Product,
  SearchMethod,
  UserProductPreference,
} from '@fetchr/schema/base/base';
import {
  explore_requests as DbExploreRequest,
  product_preferences as DbProductPreference,
  style_swipe,
  products_clean as dbProduct,
} from '@prisma/client';
import { logService } from '../logging/logService';
import {
  convertCategoryToDbCategory,
  convertDbCategoryToCategory,
  convertDbGenderToGender,
  convertExploreRequestTypeToDbExploreRequestType,
  convertFitToDbFit,
  convertGenderToDbGender,
} from '../../../shared/converters';

export async function convertDbRequesttoRequest(
  requestModel: DbExploreRequest,
): Promise<ExploreRequest> {
  if (!requestModel.query) {
    logService.critical('Request query is null', {
      metadata: { requestModel },
    });
  }
  if (!requestModel.messages || !Array.isArray(requestModel.messages)) {
    logService.critical('Request messages is not a valid JSON array', {
      metadata: { requestModel },
    });
  }

  return {
    id: requestModel.id,
    userId: requestModel.user_id,
    query: requestModel.query ?? '',
    lowerBudget: requestModel.lower_budget ? Number(requestModel.lower_budget) : undefined,
    upperBudget: requestModel.upper_budget ? Number(requestModel.upper_budget) : undefined,
    brandIds: requestModel.brand_ids,
    category: requestModel.category
      ? convertDbCategoryToCategory(requestModel.category)
      : undefined,
    gender: convertDbGenderToGender(requestModel.gender),
    generatedTitle: requestModel.generated_title ?? undefined,
    createdAt: requestModel.created_at.toISOString(),
    devIsDevOnly: requestModel.dev_is_dev_only,
    devIsDeleted: requestModel.dev_is_deleted,
    messages: [],
  };
}

export function shuffleArray<T>(array: T[]): T[] {
  return array.sort(() => Math.random() - 0.5);
}

export function convertRequestToDbRequest(
  request: ExploreRequest,
): Omit<DbExploreRequest, 'created_at'> {
  return {
    id: request.id,
    user_id: request.userId,
    query: request.query,
    lower_budget: request.lowerBudget ? request.lowerBudget.toString() : null,
    upper_budget: request.upperBudget ? request.upperBudget.toString() : null,
    brand_ids: request.brandIds,
    category: request.category ? convertCategoryToDbCategory(request.category) : null,
    gender: convertGenderToDbGender(request.gender),
    dev_is_dev_only: request.devIsDevOnly || false,
    dev_is_deleted: request.devIsDeleted || false,
    original_user_query: request.query,
    product_suggestions: [],
    status: 'PROCESSING',
    order_scheduled_for: null,
    phase: 'EXPLORATION',
    generated_title: request.generatedTitle || null,
    messages: [],
    image_urls: [],
    version: 0,
    request_type: request.requestType
      ? convertExploreRequestTypeToDbExploreRequestType(request.requestType)
      : null,
    product_id: request.productId ?? null,
  };
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
  } else if (['maybe', 'maybe-like', 'maybe_like'].includes(type)) {
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

export function convertDbProductPreferenceToProductPreference(
  preference: DbProductPreference,
): UserProductPreference {
  return {
    id: preference.id,
    preferenceType: preference.preference_type
      ? convertDbPreferenceTypeToPreferenceType(preference.preference_type)
      : undefined,
    userId: preference.user_id,
    productId: preference.product_id,
    requestId: preference.request_id,
    cohort: Number(preference.cohort),
    query: preference.query ?? undefined,
    comments: preference.comments ?? undefined,
  };
}

export function convertProductPreferenceToDbProductPreference(
  preference: UserProductPreference,
): DbProductPreference;
export function convertProductPreferenceToDbProductPreference(
  preference: Omit<UserProductPreference, 'id'>,
): Omit<DbProductPreference, 'id'> {
  const preferenceObj = {
    user_id: preference.userId,
    product_id: preference.productId,
    request_id: preference.requestId,
    preference_type: preference.preferenceType
      ? convertPreferenceTypeToDbPreferenceType(preference.preferenceType)
      : null,
    cohort: BigInt(preference.cohort),
    query: preference.query ?? null,
    comments: preference.comments ?? null,
    created_at: new Date(),
  };

  if ('id' in preference && preference.id) {
    return {
      ...preferenceObj,
      id: preference.id,
    } as DbProductPreference;
  }

  return preferenceObj;
}

export function convertSearchMethodToSearchMethodString(
  searchMethod: SearchMethod,
): 'image' | 'text' {
  switch (searchMethod) {
    case SearchMethod.SEARCH_METHOD_IMAGE:
      return 'image';
    case SearchMethod.SEARCH_METHOD_TEXT:
      return 'text';
    default:
      throw new Error(`Invalid search method: ${searchMethod}`);
  }
}

export function convertSearchMethodStringToSearchMethod(
  searchMethod: 'image' | 'text',
): SearchMethod {
  switch (searchMethod) {
    case 'image':
      return SearchMethod.SEARCH_METHOD_IMAGE;
    case 'text':
      return SearchMethod.SEARCH_METHOD_TEXT;
  }
}

export function convertProductToDbProduct(product: Product): dbProduct {
  if (!product.fullGeneratedDescription) {
    logService.error('Product fullGeneratedDescription is null', {
      metadata: { product },
    });
  }

  if (!product.details) {
    logService.error('Product details is null', {
      metadata: { product },
    });
  }

  return {
    brand_id: product.brandId,
    title: product.title,
    // @ts-expect-error number is automatically converted to Decimal
    price: product.price,
    url: product.url,
    gender: convertGenderToDbGender(product.gender),
    description: product.description || null,
    compressed_jpg_urls: product.compressedImageUrls,
    category: product.category ? convertCategoryToDbCategory(product.category) : null,
    fit: product.fit ? convertFitToDbFit(product.fit) : null,
    created_at: new Date(),
    id: product.id,
    generated_description: product.fullGeneratedDescription || '',
    image_urls: product.imageUrls,
    colors: product.colors,
    materials: product.materials,
    sizes: product.sizes,
    s3_image_urls: product.s3ImageUrls,
    style: product.style || '',
    details: product.details || '',
  };
}
