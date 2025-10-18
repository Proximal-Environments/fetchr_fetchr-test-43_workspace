import { ProductCategory, SearchMethod } from '@fetchr/schema/base/base';
import { productService, pineconeService } from '../../src/fetchr/base/service_injection/global';

interface Task {
  offset: number;
  size: number;
  category?: ProductCategory;
  searchMethod: SearchMethod;
}

export default async function processChunk({
  offset,
  size,
  category,
  searchMethod,
}: Task): Promise<string> {
  try {
    const products = await productService.getProducts(size, offset, category);
    if (!products || products.length === 0) {
      return `No products found for offset ${offset}, size ${size}`;
    }

    // 2) Update the index with these products
    const { averageTimeToGetImage, averageTimeToGetEmbedding, averageTimeToUpsert } =
      await pineconeService.batchInsertProducts(products, searchMethod);

    // 3) Optional: Send a progress message
    return `Processed chunk of ${products.length} products at offset ${offset} with average time to get image ${averageTimeToGetImage}ms, average time to get embedding ${averageTimeToGetEmbedding}ms, and average time to upsert ${averageTimeToUpsert}ms`;
  } catch (error) {
    console.error('Error in worker:', error);
    throw error;
  }
}
