import { SearchQuery } from '@fetchr/schema/base/base';
import { gender as dbGender, product_category as dbCategory, fit as dbFit } from '@prisma/client';
import { convertCategoryToDbCategory, convertGenderToDbGender } from '../../../shared/converters';

export type ProductMetadataFilter = {
  gender?: dbGender;
  category?: dbCategory;
  fit?: dbFit;
  price?: { [key: string]: number };
  brand_id?: { [key: string]: string[] };
  id?: { [key: string]: string[] };
  embedding_version?: number;
};

export function convertSearchQueryToProductMetadataFilter(
  searchQuery: SearchQuery,
): ProductMetadataFilter {
  const metadataFilter: ProductMetadataFilter = {
    gender: searchQuery.gender ? convertGenderToDbGender(searchQuery.gender) : undefined,
    category: searchQuery.category ? convertCategoryToDbCategory(searchQuery.category) : undefined,
    fit: undefined,
    price: {},
    brand_id: {},
    id: {},
    embedding_version: undefined,
  };

  if (searchQuery.minPrice !== undefined || searchQuery.maxPrice !== undefined) {
    metadataFilter.price = {};
    if (searchQuery.minPrice !== undefined) {
      metadataFilter.price['$gte'] = searchQuery.minPrice;
    }
    if (searchQuery.maxPrice !== undefined && searchQuery.maxPrice !== 0) {
      metadataFilter.price['$lte'] = searchQuery.maxPrice;
    }
  }

  if (searchQuery.brandIds?.length) {
    metadataFilter.brand_id = { $in: searchQuery.brandIds };
  }

  if (searchQuery.productIdWhitelist?.length) {
    metadataFilter.id = { $in: searchQuery.productIdWhitelist };
  } else if (searchQuery.productIdBlacklist?.length) {
    metadataFilter.id = { $nin: searchQuery.productIdBlacklist };
  }

  if (searchQuery.embeddingVersion !== undefined) {
    metadataFilter.embedding_version = searchQuery.embeddingVersion;
  }

  return metadataFilter;
}

export function calculateCosineSimilarity(vecA: number[], vecB: number[]): number {
  const dotProduct = vecA.reduce((sum, a, idx) => sum + a * vecB[idx], 0);
  const normA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const normB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return dotProduct / (normA * normB);
}

export interface SparseVector {
  indices: number[];
  values: number[];
}

/**
 * Hybrid score using a convex combination
 * alpha * dense + (1 - alpha) * sparse
 *
 * @param dense Array of floats representing dense vector
 * @param sparse Object with indices and values arrays
 * @param alpha Scale between 0 and 1
 * @returns Tuple of scaled dense vector and scaled sparse vector
 */
export function hybridScoreNorm(
  dense: number[],
  sparse: SparseVector,
  alpha: number,
): [number[], SparseVector] {
  if (alpha < 0 || alpha > 1) {
    throw new Error('Alpha must be between 0 and 1');
  }

  const hs: SparseVector = {
    indices: sparse.indices,
    values: sparse.values.map(v => v * (1 - alpha)),
  };

  return [dense.map(v => v * alpha), hs];
}
