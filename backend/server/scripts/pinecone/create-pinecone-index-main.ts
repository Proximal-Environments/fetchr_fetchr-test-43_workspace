import Piscina from 'piscina';
import path from 'path';
import { productService } from '../../src/fetchr/base/service_injection/global';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { ProductCategory, SearchMethod } from '@fetchr/schema/base/base';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Batch size for each chunk
const BATCH_SIZE = 30;

const pool = new Piscina({
  filename: path.resolve(__dirname, './create-pinecone-index-worker.ts'),
  minThreads: 1,
  maxThreads: 1,
});

const searchMethod: SearchMethod =
  SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE_AVERAGE_SPARSE_CLEAN_WITH_SEMANTIC_METADATA;
const category: ProductCategory | undefined = ProductCategory.PRODUCT_CATEGORY_TOPS;
const startingPoint = 0; // 13000
const endPoint = null;

// const readlineInterface = readline.createInterface({
//   input: process.stdin,
//   output: process.stdout,
// });

// const shouldDelete = await new Promise<boolean>(resolve => {
//   readlineInterface.question('Do you want to delete the existing index? (y/n): ', answer => {
//     readlineInterface.close();
//     resolve(answer.toLowerCase() === 'y');
//   });
// });

// if (shouldDelete) {
//   console.log('Cleaning existing index...');
//   await pineconeService.cleanIndexForSearchMethod(searchMethod);
// } else {
//   console.log('Skipping index cleanup');
// }

async function runParentProcess(): Promise<void> {
  try {
    // 1) Count the total products
    const totalProducts = await productService.countProducts(category);
    console.log(`Total products: ${totalProducts}`);

    // Start from product 24,000
    let currentOffset = startingPoint;
    let processedProducts = startingPoint;

    const targetEndPoint = endPoint ?? totalProducts;

    // Create tasks starting from offset 25,000
    const tasks: Array<{
      offset: number;
      size: number;
      searchMethod: SearchMethod;
      category: ProductCategory | undefined;
    }> = [];
    while (currentOffset < Math.min(targetEndPoint, totalProducts)) {
      const size = Math.min(BATCH_SIZE, Math.min(targetEndPoint, totalProducts) - currentOffset);
      tasks.push({ offset: currentOffset, size, searchMethod, category });
      currentOffset += size;
    }

    console.log(
      `Created ${tasks.length} tasks total, each up to size ${BATCH_SIZE}, starting from product ${processedProducts}`,
    );

    // 4) Run tasks in parallel using Piscina thread pool
    try {
      await Promise.all(
        tasks.map(async task => {
          const result = await pool.run(task);
          processedProducts += task.size;
          console.log(
            `Progress: ${processedProducts}/${Math.min(
              targetEndPoint,
              totalProducts,
            )} products processed (${Math.round(
              (processedProducts / Math.min(targetEndPoint, totalProducts)) * 100,
            )}%)\nResult: ${result}`,
          );
        }),
      );
      console.log('All workers have completed updating clean Siglip index');
    } catch (error) {
      console.error('Error in worker thread:', error);
      throw error;
    }
  } catch (error) {
    console.error('Error in parent process:', error);
    process.exit(1);
  }
}

runParentProcess();
