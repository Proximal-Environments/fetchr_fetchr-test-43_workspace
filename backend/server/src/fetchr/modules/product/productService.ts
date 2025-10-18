/* eslint-disable @typescript-eslint/no-explicit-any */
import { inject, injectable } from 'inversify';
import { BaseService } from '../../base/service_injection/baseService';
import { supabaseDb } from '../../base/database/supabaseDb';
import { DEFAULT_SEARCH_METHOD, PineconeService } from '../../core/pinecone/pineconeService';
import {
  Product,
  Gender,
  ProductCategory,
  ProductFit,
  PreferenceType,
  PopulatedUserProductPreference,
  ProductWithSearchQuery,
  SearchMethod,
  ProductWithScoreAndSearchQuery,
  ProductWithScore,
  Brand,
  SearchQuery,
  PopulatedImagePreferenceItem,
} from '@fetchr/schema/base/base';
import { products_clean as dbProduct } from '@prisma/client';
import {
  convertCategoryToDbCategory,
  convertDbCategoryToCategory,
  convertDbFitToFit,
  convertDbGenderToGender,
  convertFitToDbFit,
  convertGenderToDbGender,
} from '../../../shared/converters';
import { Prisma } from '@prisma/client';
import {
  calculateCosineSimilarity,
  convertSearchQueryToProductMetadataFilter,
} from '../../core/pinecone/pineconeUtils';
import { CACHE_CONFIGS, RedisService } from '../../core/redis/redisService';
import { logService } from '../../base/logging/logService';
import { Decimal } from '@prisma/client/runtime/library';
import { Perf } from '../../core/performance/performance';

@injectable()
export class ProductService extends BaseService {
  constructor(
    @inject(PineconeService) private pineconeService: PineconeService,
    @inject(RedisService) private redisService: RedisService,
    @inject(Perf) private perfService: Perf,
  ) {
    super('ProductService', logService);
  }

  async countProducts(category?: ProductCategory): Promise<number> {
    const where: Prisma.products_cleanWhereInput = {};
    if (category) {
      where.category = convertCategoryToDbCategory(category);
    }
    return await supabaseDb.products_clean.count({ where });
  }

  async getProduct(productId: string): Promise<Product | null> {
    try {
      // Try to get product from Redis cache first
      const cacheKey = `product:${productId}`;
      // const cachedProduct = await this.redisService.get<Product>(cacheKey, CACHE_CONFIGS.PRODUCT);

      // if (cachedProduct) {
      //   this.logService.debug(`Cache hit for product ${productId}`);
      //   return cachedProduct;
      // }

      this.logService.debug(`Cache miss for product ${productId}, fetching from database`);
      const productData = await supabaseDb.products_clean.findUnique({
        where: { id: productId },
      });

      if (!productData) {
        return null;
      }

      const product = await this.convertDbProductToProduct(productData);

      // Cache the product for future requests
      await this.redisService.set(cacheKey, product, CACHE_CONFIGS.PRODUCT);

      return product;
    } catch (error) {
      this.logService.error(`Error fetching product ${productId}: ${error}`);
      return null;
    }
  }

  async getProductOrFail(productId: string): Promise<Product> {
    const product = await this.getProduct(productId);
    if (!product) {
      throw new Error(`Product ${productId} not found`);
    }
    return product;
  }

  async productExists(productId: string): Promise<boolean> {
    try {
      const productData = await supabaseDb.products_clean.findUnique({
        where: { id: productId },
        select: { id: true },
      });
      return productData !== null;
    } catch (error) {
      this.logService.error(`Error checking if product exists: ${error}`);
      return false;
    }
  }

  async getProductDescription(productId: string): Promise<string> {
    try {
      const productData = await supabaseDb.products_clean.findUnique({
        where: { id: productId },
        select: { generated_description: true },
      });
      if (productData && productData.generated_description) {
        return productData.generated_description;
      }
      return 'No description available';
    } catch (error) {
      this.logService.error(`Error in getProductDescription: ${error}`);
      return 'Error fetching description';
    }
  }

  async getBrandName(brandId: string): Promise<string> {
    try {
      // Try to get brand name from Redis cache first
      const cacheKey = `brand:${brandId}`;
      const cachedBrandName = await this.redisService.get<string>(cacheKey, CACHE_CONFIGS.PRODUCT);

      if (cachedBrandName) {
        // this.logService.debug(`Cache hit for brand ${brandId}`);
        return cachedBrandName;
      }

      // this.logService.debug(`Cache miss for brand ${brandId}, fetching from database`);
      const brandData = await supabaseDb.brands.findUnique({
        where: { id: brandId },
        select: { company: true },
      });

      if (brandData && brandData.company) {
        // Cache the brand name for future requests
        await this.redisService.set(cacheKey, brandData.company, CACHE_CONFIGS.PRODUCT);
        return brandData.company;
      }

      this.logService.critical(`Brand not found for brandId=${brandId}`);
      return 'Unknown';
    } catch (error) {
      this.logService.error(`Error fetching brand name for brandId=${brandId}: ${error}`);
      return 'Unknown';
    }
  }

  async getBrandNameBatch(brandIds: string[]): Promise<(string | null)[]> {
    try {
      // Try to get all brand names from Redis cache first
      const cacheKeys = brandIds.map(id => `brand:${id}`);
      const cachedBrandNames = await this.redisService.mget<string>(
        cacheKeys,
        CACHE_CONFIGS.PRODUCT,
      );

      // Find which brand IDs need to be fetched from DB
      const missingBrandIds = brandIds.filter((_, index) => !cachedBrandNames[index]);

      let brandNames = [...cachedBrandNames];

      if (missingBrandIds.length > 0) {
        // Single DB call for all missing brands
        const brandData = await supabaseDb.brands.findMany({
          where: { id: { in: missingBrandIds } },
          select: { id: true, company: true },
        });

        // Update cache and results
        for (const brand of brandData) {
          const index = brandIds.indexOf(brand.id);
          if (index !== -1) {
            brandNames[index] = brand.company;
            await this.redisService.set(`brand:${brand.id}`, brand.company, CACHE_CONFIGS.PRODUCT);
          }
        }

        // Fill in 'Unknown' for any remaining missing brands
        brandNames = brandNames.map(name => name || 'Unknown');
      }

      return brandNames;
    } catch (error) {
      this.logService.error(`Error fetching brand names batch: ${error}`);
      return brandIds.map(() => 'Unknown');
    }
  }

  async getSubbrandNameBatch(subBrandIds: string[]): Promise<(string | null)[]> {
    try {
      // Try to get all subbrand names from Redis cache first
      const cacheKeys = subBrandIds.map(id => `subbrand:${id}`);
      const cachedSubbrandNames = await this.redisService.mget<string>(
        cacheKeys,
        CACHE_CONFIGS.PRODUCT,
      );

      // Find which subbrand IDs need to be fetched from DB
      const missingSubbrandIds = subBrandIds.filter((_, index) => !cachedSubbrandNames[index]);

      let subbrandNames = [...cachedSubbrandNames];

      if (missingSubbrandIds.length > 0) {
        // Single DB call for all missing subbrands
        const subbrandData = await supabaseDb.sub_brands.findMany({
          where: { id: { in: missingSubbrandIds } },
          select: { id: true, display_name: true },
        });

        // Update cache and results
        for (const subbrand of subbrandData) {
          const index = subBrandIds.indexOf(subbrand.id);
          if (index !== -1 && subbrand.display_name) {
            const formattedName = subbrand.display_name
              .split(' ')
              .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
              .join(' ');

            subbrandNames[index] = formattedName;
            await this.redisService.set(
              `subbrand:${subbrand.id}`,
              formattedName,
              CACHE_CONFIGS.PRODUCT,
            );
          }
        }

        // Fill in 'Unknown' for any remaining missing subbrands
        subbrandNames = subbrandNames.map(name => name || 'Unknown');
      }

      return subbrandNames;
    } catch (error) {
      this.logService.error(`Error fetching subbrand names batch: ${error}`);
      return subBrandIds.map(() => 'Unknown');
    }
  }

  async getSubbrandName(subBrandId: string): Promise<string> {
    try {
      // Try to get subbrand name from Redis cache first
      const cacheKey = `subbrand:${subBrandId}`;
      const cachedSubbrandName = await this.redisService.get<string>(
        cacheKey,
        CACHE_CONFIGS.PRODUCT,
      );

      if (cachedSubbrandName) {
        // this.logService.debug(`Cache hit for subbrand ${subBrandId}`);
        return cachedSubbrandName;
      }

      // this.logService.debug(`Cache miss for subbrand ${subBrandId}, fetching from database`);
      const brandData = await supabaseDb.sub_brands.findUnique({
        where: { id: subBrandId },
      });

      if (brandData && brandData.display_name) {
        const formattedName = brandData.display_name
          .split(' ')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' ');

        // Cache the formatted subbrand name for future requests
        await this.redisService.set(cacheKey, formattedName, CACHE_CONFIGS.PRODUCT);
        return formattedName;
      }

      this.logService.critical(`Brand not found for brandId=${subBrandId}`);
      return 'Unknown';
    } catch (error) {
      this.logService.error(`Error fetching subbrand name for brandId=${subBrandId}: ${error}`);
      return 'Unknown';
    }
  }

  convertProductToDbProduct(product: Product): dbProduct {
    return {
      manually_added: false,
      highres_webp_urls: product.highresWebpUrls,
      brand_id: product.brandId,
      title: product.title,
      price: product.originalPrice
        ? new Decimal(product.originalPrice)
        : new Decimal(product.price),
      url: product.url,
      gender: convertGenderToDbGender(product.gender),
      description: product.description || null,
      compressed_jpg_urls: product.compressedImageUrls,
      category: product.category ? convertCategoryToDbCategory(product.category) : null,
      fit: product.fit ? convertFitToDbFit(product.fit) : null,
      created_at: new Date(),
      id: product.id,
      generated_description: product.fullGeneratedDescription ?? '',
      image_urls: product.imageUrls,
      colors: product.colors,
      materials: product.materials,
      sizes: product.sizes,
      s3_image_urls: product.s3ImageUrls,
      style: product.style ?? '',
      details: product.details ?? '',
      sub_brand_id: product.subBrandId || null,
      is_for_kids: product.isKidProduct,
      structured_sizes: null,
      sale_price: product.originalPrice ? new Decimal(product.price) : null,
      content_quality_check: product.scrapingMetadata?.contentQualityCheck ?? null,
      pipeline_run_id: product.scrapingMetadata?.pipelineRunId ?? null,
    };
  }

  async convertDbProductToProductBatch(dbProducts: dbProduct[]): Promise<Product[]> {
    try {
      const brandIds = [...new Set(dbProducts.map(product => product.brand_id))];
      const subBrandIds = [
        ...new Set(
          dbProducts.map(product => product.sub_brand_id).filter((id): id is string => !!id),
        ),
      ];

      const [brandNames, subBrandNames] = await Promise.all([
        this.getBrandNameBatch(brandIds),
        this.getSubbrandNameBatch(subBrandIds),
      ]);

      const brandNameMap = new Map(brandIds.map((id, index) => [id, brandNames[index]]));
      const subBrandNameMap = new Map(subBrandIds.map((id, index) => [id, subBrandNames[index]]));

      return dbProducts
        .map((dbProduct): Product | null => {
          if (!dbProduct.generated_description) {
            // this.logService.warn(
            //   `Product ${dbProduct.id} has no generated description. Using title as fallback.`,
            // );
            dbProduct.generated_description = dbProduct.title;
          }

          // if (!dbProduct.gender) {
          //   this.logService.warn(
          //     `Product ${dbProduct.id} has no gender. Using UNISEX as fallback.`,
          //   );
          // }

          // if (!dbProduct.fit) {
          //   this.logService.warn(`Product ${dbProduct.id} has no fit. Using REGULAR as fallback.`);
          // }

          // if (!dbProduct.style) {
          //   this.logService.warn(`Product ${dbProduct.id} has no style.`);
          // }

          // if (!dbProduct.colors.length) {
          //   this.logService.warn(`Product ${dbProduct.id} has no colors.`);
          // }

          const brandName = brandNameMap.get(dbProduct.brand_id);
          const subBrandName = dbProduct.sub_brand_id
            ? subBrandNameMap.get(dbProduct.sub_brand_id)
            : undefined;

          if (!brandName) {
            // this.logService.warn(`Product ${dbProduct.id} has no brand name.`);
            return null;
          }

          if (!subBrandName) {
            // this.logService.warn(`Product ${dbProduct.id} has no sub brand name.`);
          }

          return {
            id: dbProduct.id.toString(),
            brandId: dbProduct.brand_id,
            category: dbProduct.category
              ? convertDbCategoryToCategory(dbProduct.category)
              : undefined,
            description: dbProduct.description ?? '',
            colors: dbProduct.colors || [],
            materials: dbProduct.materials || [],
            compressedImageUrls: dbProduct.compressed_jpg_urls,
            style: dbProduct.style || '',
            details: dbProduct.details || '',
            brandName: brandName,
            subBrandName: subBrandName ?? undefined,
            s3ImageUrls: dbProduct.s3_image_urls,
            imageUrls: dbProduct.image_urls,
            title: dbProduct.title,
            name: dbProduct.title,
            price: Number(
              dbProduct.sale_price instanceof Decimal ? dbProduct.sale_price : dbProduct.price,
            ),
            originalPrice: dbProduct.sale_price ? Number(dbProduct.price) : undefined,
            gender: dbProduct.gender
              ? convertDbGenderToGender(dbProduct.gender)
              : Gender.GENDER_UNISEX,
            fit: dbProduct.fit ? convertDbFitToFit(dbProduct.fit) : ProductFit.PRODUCT_FIT_REGULAR,
            url: dbProduct.url,
            highresWebpUrls: dbProduct.highres_webp_urls,
            sizes: dbProduct.sizes,
            isKidProduct: dbProduct.is_for_kids ?? false,
            fullGeneratedDescription: dbProduct.generated_description,
            scrapingMetadata: {
              contentQualityCheck: dbProduct.content_quality_check ?? undefined,
              pipelineRunId: dbProduct.pipeline_run_id ?? undefined,
            },
          };
        })
        .filter(product => product !== null);
    } catch (error) {
      this.logService.error('Error converting db products to products batch', { error });
      throw error;
    }
  }

  async convertDbProductToProduct(dbProduct: dbProduct): Promise<Product> {
    try {
      // if (!dbProduct.generated_description) {
      //   this.logService.warn(
      //     `Product ${dbProduct.id} has no generated description. Using title as fallback.`,
      //   );
      //   dbProduct.generated_description = dbProduct.title;
      // }

      // if (!dbProduct.gender) {
      //   this.logService.warn(`Product ${dbProduct.id} has no gender. Using UNISEX as fallback.`);
      // }

      // if (!dbProduct.fit) {
      //   this.logService.warn(`Product ${dbProduct.id} has no fit. Using REGULAR as fallback.`);
      // }

      // if (!dbProduct.style) {
      //   this.logService.warn(`Product ${dbProduct.id} has no style.`);
      // }

      // if (!dbProduct.colors.length) {
      //   this.logService.warn(`Product ${dbProduct.id} has no colors.`);
      // }

      const [brandName, subBrandName] = await Promise.all([
        this.getBrandName(dbProduct.brand_id),
        dbProduct.sub_brand_id
          ? this.getSubbrandName(dbProduct.sub_brand_id)
          : Promise.resolve(undefined),
      ]);

      const product: Product = {
        id: dbProduct.id.toString(),
        brandId: dbProduct.brand_id,
        category: dbProduct.category ? convertDbCategoryToCategory(dbProduct.category) : undefined,
        description: dbProduct.description ?? '',
        colors: dbProduct.colors || [],
        materials: dbProduct.materials || [],
        compressedImageUrls: dbProduct.compressed_jpg_urls,
        style: dbProduct.style || '',
        details: dbProduct.details || '',
        brandName: brandName,
        subBrandName: subBrandName,
        s3ImageUrls: dbProduct.s3_image_urls,
        imageUrls: dbProduct.image_urls,
        title: dbProduct.title,
        price: Number(
          dbProduct.sale_price instanceof Decimal
            ? dbProduct.sale_price.toNumber()
            : dbProduct.price.toNumber(),
        ),
        originalPrice: dbProduct.sale_price ? Number(dbProduct.price) : undefined,
        gender: convertDbGenderToGender(dbProduct.gender ?? 'UNISEX'),
        generatedDescription: dbProduct.generated_description,
        fullGeneratedDescription: this.getFullGeneratedProductDescription(
          dbProduct,
          brandName,
          subBrandName,
        ),
        url: dbProduct.url,
        fit: convertDbFitToFit(dbProduct.fit ?? 'REGULAR'),
        sizes: dbProduct.sizes || [],
        name: dbProduct.title,
        isKidProduct: dbProduct.is_for_kids ?? false,
        scrapingMetadata: {
          contentQualityCheck: dbProduct.content_quality_check ?? undefined,
          pipelineRunId: dbProduct.pipeline_run_id ?? undefined,
        },
        highresWebpUrls: dbProduct.highres_webp_urls || [],
      };

      return product;
    } catch (error) {
      this.logService.error(`Error converting product model to Product: ${error}`);
      this.logService.error(`Product model: ${JSON.stringify(dbProduct)}`);
      throw error;
    }
  }

  getFullGeneratedProductDescription(
    productModel: dbProduct,
    brandName: string,
    subBrandName: string | undefined,
  ): string {
    const description = {
      title: productModel.title,
      // price: productModel.price,
      gender: productModel.gender,
      generated_description: productModel.generated_description,
      colors: productModel.colors,
      materials: productModel.materials,
      category: productModel.category,
      style: productModel.style,
      fit: productModel.fit,
      brandName: brandName,
      subBrandName: subBrandName,
    };

    return JSON.stringify(description);
  }

  async listProducts(limit: number = 10, offset: number = 0): Promise<Product[]> {
    try {
      const products = await supabaseDb.products_clean.findMany({
        skip: offset,
        take: limit,
      });
      return await Promise.all(products.map(product => this.convertDbProductToProduct(product)));
    } catch (error) {
      this.logService.error(`Error listing products: ${error}`);
      return [];
    }
  }

  async getProductsByIds(productIds: string[]): Promise<Product[]> {
    const products = await supabaseDb.products_clean.findMany({
      where: { id: { in: productIds } },
    });
    return await Promise.all(products.map(product => this.convertDbProductToProduct(product)));
  }

  async getProducts(
    limit: number = 10,
    offset: number = 0,
    category?: ProductCategory,
    fit?: ProductFit,
  ): Promise<Product[]> {
    try {
      const where: Prisma.products_cleanWhereInput = {};
      if (category) {
        where.category = convertCategoryToDbCategory(category);
      }
      if (fit) {
        where.fit = convertFitToDbFit(fit);
      }

      const products = await supabaseDb.products_clean.findMany({
        skip: offset,
        take: limit,
        where,
      });
      return await Promise.all(products.map(product => this.convertDbProductToProduct(product)));
    } catch (error) {
      this.logService.error(`Error getting products: ${error}`);
      return [];
    }
  }

  async getSampleProduct(category?: ProductCategory): Promise<Product> {
    try {
      const where: Prisma.products_cleanWhereInput = {};
      if (category) {
        where.category = convertCategoryToDbCategory(category);
      }

      const products = await supabaseDb.products_clean.findMany({
        where,
        take: 10000,
      });

      if (!products.length) {
        throw new Error('No products found in the database');
      }

      const randomIndex = Math.floor(Math.random() * products.length);
      return this.convertDbProductToProduct(products[randomIndex]);
    } catch (error) {
      this.logService.error(`Error in getSampleProduct: ${error}`);
      throw new Error(`Failed to get sample product: ${error}`);
    }
  }

  async getSampleProducts(count: number, category?: ProductCategory): Promise<Product[]> {
    try {
      const where: Prisma.products_cleanWhereInput = {};
      if (category) {
        where.category = convertCategoryToDbCategory(category);
      }

      const products = await supabaseDb.products_clean.findMany({
        where,
        take: count,
      });

      return await Promise.all(products.map(product => this.convertDbProductToProduct(product)));
    } catch (error) {
      this.logService.error(`Error in getSampleProducts: ${error}`);
      throw new Error(`Failed to get sample products: ${error}`);
    }
  }

  async partialProductToPartialDbProduct(product: Partial<Product>): Promise<Partial<dbProduct>> {
    const dbProduct: Partial<dbProduct> = {};

    if (product.brandId !== undefined) dbProduct.brand_id = product.brandId;
    if (product.title !== undefined) dbProduct.title = product.title;
    if (product.price !== undefined) dbProduct.price = new Decimal(product.price);
    if (product.url !== undefined) dbProduct.url = product.url;
    if (product.gender !== undefined) dbProduct.gender = convertGenderToDbGender(product.gender);
    if (product.description !== undefined) dbProduct.description = product.description;
    if (product.category !== undefined) {
      dbProduct.category = convertCategoryToDbCategory(product.category);
    }
    if (product.fit !== undefined) dbProduct.fit = convertFitToDbFit(product.fit);
    if (product.id !== undefined) dbProduct.id = product.id;
    if (product.fullGeneratedDescription !== undefined) {
      dbProduct.generated_description = product.fullGeneratedDescription;
    }
    if (product.imageUrls !== undefined) dbProduct.image_urls = product.imageUrls;
    if (product.colors !== undefined) dbProduct.colors = product.colors;
    if (product.materials !== undefined) dbProduct.materials = product.materials;
    if (product.sizes !== undefined) dbProduct.sizes = product.sizes;
    if (product.s3ImageUrls !== undefined) dbProduct.s3_image_urls = product.s3ImageUrls;
    if (product.style !== undefined) dbProduct.style = product.style;
    if (product.details !== undefined) dbProduct.details = product.details;
    if (product.isKidProduct !== undefined) dbProduct.is_for_kids = product.isKidProduct;
    if (product.scrapingMetadata !== undefined) {
      dbProduct.content_quality_check = product.scrapingMetadata.contentQualityCheck ?? null;
    }
    if (product.manuallyAdded !== undefined) dbProduct.manually_added = product.manuallyAdded;
    if (product.originalPrice !== undefined)
      dbProduct.sale_price = new Decimal(product.originalPrice);
    if (product.highresWebpUrls !== undefined)
      dbProduct.highres_webp_urls = product.highresWebpUrls;
    if (product.compressedImageUrls !== undefined)
      dbProduct.compressed_jpg_urls = product.compressedImageUrls;
    if (product.subBrandId !== undefined) dbProduct.sub_brand_id = product.subBrandId;
    if (product.scrapingMetadata?.pipelineRunId !== undefined)
      dbProduct.pipeline_run_id = product.scrapingMetadata.pipelineRunId;

    return dbProduct;
  }

  async insertProduct(product: Product): Promise<void> {
    try {
      this.logService.info(`Inserting/updating product ${product.id} into Supabase`, {
        metadata: { product },
      });

      const productModel = this.convertProductToDbProduct(product);

      // Check if product exists
      const existingProduct = await supabaseDb.products_clean.findUnique({
        where: { id: product.id },
      });

      if (existingProduct) {
        // Update existing product
        await supabaseDb.products_clean.update({
          where: { id: product.id },
          data: {
            ...productModel,
            structured_sizes: productModel.structured_sizes as any,
          },
        });
        this.logService.info(`Successfully updated product ${product.id} in Supabase`);
      } else {
        // Insert new product
        await supabaseDb.products_clean.create({
          data: {
            ...productModel,
            structured_sizes: productModel.structured_sizes as any,
          },
        });
        this.logService.info(`Successfully inserted product ${product.id} into Supabase`);
      }

      // Update Pinecone regardless of whether it was an insert or update
      try {
        await this.pineconeService.insertProductForEverySearchMethod(product);
      } catch (pineconeError) {
        this.logService.error(`Error inserting product into Pinecone: ${pineconeError.message}`, {
          metadata: { product },
          error: pineconeError,
        });

        // Only roll back if this was a new product
        if (!existingProduct) {
          try {
            await supabaseDb.products_clean.delete({
              where: { id: product.id },
            });
            this.logService.info(
              `Rolled back product ${product.id} insertion due to Pinecone error`,
            );
          } catch (deleteError) {
            this.logService.error(`Failed to roll back product insertion: ${deleteError.message}`, {
              metadata: { productId: product.id },
              error: deleteError,
            });
          }
        }
        throw pineconeError;
      }

      // Update cache
      await this.updateProductCache(product.id);
    } catch (error) {
      this.logService.error(`Error inserting/updating product ${product.id}: ${error}`);
      throw error;
    }
  }

  async clearProductCache(productId: string): Promise<void> {
    await this.redisService.del(`product:${productId}`, CACHE_CONFIGS.PRODUCT);
  }

  async updateProductCache(productId: string): Promise<void> {
    await this.clearProductCache(productId);
    const product = await this.getProduct(productId);
    if (product) {
      await this.redisService.set(`product:${productId}`, product, CACHE_CONFIGS.PRODUCT);
    }
  }

  async updateProduct(productId: string, productUpdate: Partial<Product>): Promise<Product> {
    try {
      const dbProductUpdate = await this.partialProductToPartialDbProduct(productUpdate);

      // Check if there are any actual changes to apply
      if (Object.keys(dbProductUpdate).length === 0) {
        this.logService.info(`No changes to apply for product ${productId}`);
        return await this.getProductOrFail(productId);
      }

      const original = await supabaseDb.products_clean.findUnique({
        where: { id: productId },
      });

      const updated = await supabaseDb.products_clean.update({
        where: { id: productId },
        data: {
          ...dbProductUpdate,
          structured_sizes: dbProductUpdate.structured_sizes as any,
        },
      });

      if (updated && JSON.stringify(updated) !== JSON.stringify(original)) {
        this.logService.info(`Successfully updated product ${productId} in database`);

        // Update Pinecone
        const fullProduct = await this.getProduct(productId);
        if (fullProduct) {
          await this.pineconeService.updateProductMetadata(productId, productUpdate, fullProduct);
          this.logService.info(`Successfully updated product ${productId} in Pinecone`);
        }
      }
      this.updateProductCache(productId);

      return this.convertDbProductToProduct(updated);
    } catch (error) {
      this.logService.error(`Error updating product ${productId}: ${error}`);
      throw error;
    }
  }

  async updateProductCategory(productId: string, category: ProductCategory): Promise<boolean> {
    try {
      await this.updateProduct(productId, { category });
      return true;
    } catch (error) {
      this.logService.error(`Error updating product category: ${error}`);
      return false;
    }
  }

  async updateProductColors(productId: string, colors: string[]): Promise<boolean> {
    try {
      await this.updateProduct(productId, { colors });
      return true;
    } catch (error) {
      this.logService.error(`Error updating product colors: ${error}`);
      return false;
    }
  }

  async getProductCategory(productId: string): Promise<string | null> {
    try {
      const product = await this.getProduct(productId);
      if (product && product.category) {
        return convertCategoryToDbCategory(product.category);
      }
      return null;
    } catch (error) {
      this.logService.error(`Error getting product category: ${error}`);
      return null;
    }
  }

  async getProductColors(productId: string): Promise<string[] | null> {
    try {
      const product = await this.getProduct(productId);
      if (product && product.colors) {
        return product.colors;
      }
      return null;
    } catch (error) {
      this.logService.error(`Error getting product colors: ${error}`);
      return null;
    }
  }

  async getProductsByBrand(
    brandId: string,
    limit: number = 10,
    offset: number = 0,
  ): Promise<Product[]> {
    try {
      const products = await supabaseDb.products_clean.findMany({
        where: { brand_id: brandId },
        skip: offset,
        take: limit,
      });
      return await Promise.all(products.map(product => this.convertDbProductToProduct(product)));
    } catch (error) {
      this.logService.error(`Error getting products by brand: ${error}`);
      return [];
    }
  }

  /**
   * Retrieve products in parallel given a list of product IDs.
   */
  async getProductsInParallel(
    productIds: string[],
    gender?: Gender,
    brandId?: string,
    minPrice?: number,
    maxPrice?: number,
  ): Promise<Product[]> {
    const batchSize = 250;
    const productMap: Record<string, Product> = {};

    try {
      const batchPromises = [];
      for (let i = 0; i < productIds.length; i += batchSize) {
        const batchIds = productIds.slice(i, i + batchSize);

        const where: Prisma.products_cleanWhereInput = {
          id: { in: batchIds },
        };

        if (gender) {
          where.gender = convertGenderToDbGender(gender);
        }

        if (brandId) {
          where.brand_id = brandId;
        }

        if (minPrice !== undefined || maxPrice !== undefined) {
          this.logService.info(`Applying price filters`, {
            metadata: {
              minPrice,
              maxPrice,
              whereClause: {
                ...(minPrice !== undefined && { gte: minPrice }),
                ...(maxPrice !== undefined && { lte: maxPrice }),
              },
            },
          });
          where.price = {
            ...(minPrice !== undefined && { gte: minPrice }),
            ...(maxPrice !== undefined && { lte: maxPrice }),
          };
        }

        // Add each batch query to our array of promises
        batchPromises.push(supabaseDb.products_clean.findMany({ where }));
      }

      // Execute all batch queries in parallel
      const batchResults = await Promise.all(batchPromises);

      // Process all products from all batches in parallel
      await Promise.all(
        batchResults.flat().map(async productData => {
          const product = await this.convertDbProductToProduct(productData);
          productMap[product.id] = product;
        }),
      );

      const orderedProducts = productIds.filter(id => id in productMap).map(id => productMap[id]);

      this.logService.info(`Total products retrieved: ${orderedProducts.length}`);
      return orderedProducts;
    } catch (error) {
      this.logService.error(`Error retrieving product data: ${error}`);
      return [];
    }
  }

  /**
   * Search products using image-based embeddings.
   */
  async searchProducts(
    searchQuery: SearchQuery | string,
    topK: number,
    searchMethod: SearchMethod,
  ): Promise<Product[]> {
    try {
      const searchResults = await this.pineconeService.searchProducts(
        typeof searchQuery === 'string' ? searchQuery : searchQuery.query,
        searchMethod,
        topK,
        typeof searchQuery === 'string'
          ? undefined
          : convertSearchQueryToProductMetadataFilter(searchQuery),
      );

      const productIds = searchResults.map(result => result.id);
      return await this.getProductsInParallel(productIds);
    } catch (error) {
      this.logService.error(`Error in searchProducts: ${error}`);
      return [];
    }
  }

  /**
   * Get the embedding vector for a product.
   */
  async getProductEmbedding(
    productId: string,
    searchMethod: SearchMethod,
  ): Promise<number[] | null> {
    try {
      return await this.pineconeService.getItemEmbedding(productId, searchMethod);
    } catch (error) {
      this.logService.error(`Error getting product embedding: ${error}`);
      return null;
    }
  }

  async batchGetProductEmbeddings(
    productIds: string[],
    searchMethod: SearchMethod,
  ): Promise<(number[] | null)[]> {
    try {
      return await this.pineconeService.batchGetItemEmbeddings(productIds, searchMethod);
    } catch (error) {
      this.logService.error('Error getting batch product embeddings', {
        metadata: { error, productIds },
      });
      return productIds.map(() => null);
    }
  }

  /**
   * Rerank products based on user preferences by computing similarity scores.
   */
  async rerankProductsUsingPreferences(
    products: ProductWithSearchQuery[],
    userProductPreferences: PopulatedUserProductPreference[],
    searchMethod: SearchMethod,
    likedProductScoreMultiplier?: number,
    originalScoreMultiplier?: number,
    productImagePreferences?: PopulatedImagePreferenceItem[],
  ): Promise<ProductWithScoreAndSearchQuery[]>;
  async rerankProductsUsingPreferences(
    products: ProductWithScoreAndSearchQuery[],
    userProductPreferences: PopulatedUserProductPreference[],
    searchMethod: SearchMethod,
    likedProductScoreMultiplier?: number,
    originalScoreMultiplier?: number,
    productImagePreferences?: PopulatedImagePreferenceItem[],
  ): Promise<ProductWithScoreAndSearchQuery[]>;
  async rerankProductsUsingPreferences(
    products: Product[],
    userProductPreferences: PopulatedUserProductPreference[],
    searchMethod: SearchMethod,
    likedProductScoreMultiplier?: number,
    originalScoreMultiplier?: number,
    productImagePreferences?: PopulatedImagePreferenceItem[],
  ): Promise<ProductWithScore[]>;
  async rerankProductsUsingPreferences(
    products: ProductWithSearchQuery[] | ProductWithScoreAndSearchQuery[] | Product[],
    userProductPreferences: PopulatedUserProductPreference[],
    searchMethod: SearchMethod = DEFAULT_SEARCH_METHOD,
    likedProductScoreMultiplier: number = 10.0,
    originalScoreMultiplier: number = 0,
    productImagePreferences: PopulatedImagePreferenceItem[] = [],
  ): Promise<(ProductWithScoreAndSearchQuery | ProductWithScore)[]> {
    const perfHandle = this.perfService.start('ProductService.rerankProductsUsingPreferences');
    try {
      this.logService.info('Reranking products using preferences', {
        metadata: {
          products: products.length,
          userProductPreferences: userProductPreferences.length,
          productImagePreferences: productImagePreferences.length,
        },
      });

      if (!products.length || (!userProductPreferences.length && !productImagePreferences.length)) {
        return products.map(product => {
          if ('product' in product) {
            return {
              product: product.product,
              score: 'score' in product ? product.score : 0,
              query: product.query,
            } as ProductWithScoreAndSearchQuery;
          } else {
            return {
              product,
              score: 'score' in product ? product.score : 0,
            } as ProductWithScore;
          }
        });
      }

      if (
        userProductPreferences.length &&
        !userProductPreferences.every(p => p.productDetails?.id)
      ) {
        throw new Error('User product preferences are required for reranking');
      }

      if (
        userProductPreferences.length &&
        !userProductPreferences.every(p => p.preference?.preferenceType)
      ) {
        if (!userProductPreferences.some(p => p.preference?.preferenceType)) {
          this.logService.error('All user product preferences are missing preference type', {
            metadata: { userProductPreferences },
          });
        } else {
          this.logService.warn('Some user product preferences are missing preference type', {
            metadata: { userProductPreferences },
          });
        }
      }

      try {
        const productIdsToRerank = products
          .map(p => {
            if ('id' in p) {
              return p.id;
            } else {
              return p.product?.id;
            }
          })
          .filter(id => id) as string[];

        const [productEmbeddingsToRerank, preferenceProductEmbeddings] = await Promise.all([
          this.pineconeService.batchGetItemEmbeddings(productIdsToRerank, searchMethod),
          this.pineconeService.batchGetItemEmbeddings(
            userProductPreferences
              .map(pref => pref.productDetails?.id)
              .filter(id => id !== undefined) as string[],
            searchMethod,
          ),
        ]);

        const productScores: Array<{
          score: number;
          product: Product | ProductWithSearchQuery;
        }> = [];

        for (let i = 0; i < products.length; i++) {
          const productEmbedding = productEmbeddingsToRerank[i];
          if (!productEmbedding) {
            productScores.push({ score: 0, product: products[i] });
            continue;
          }

          let score = 0;

          // Process product preferences
          for (let j = 0; j < userProductPreferences.length; j++) {
            const pref = userProductPreferences[j];
            const prefEmbedding = preferenceProductEmbeddings[j];

            if (prefEmbedding) {
              const similarity = calculateCosineSimilarity(productEmbedding, prefEmbedding);
              if (pref.preference?.preferenceType === PreferenceType.LIKE) {
                score += similarity * likedProductScoreMultiplier;
              } else if (pref.preference?.preferenceType === PreferenceType.DISLIKE) {
                score -= similarity;
              } else if (pref.preference?.preferenceType === PreferenceType.SUPERLIKE) {
                score += similarity * likedProductScoreMultiplier * 3;
              } else if (pref.preference?.preferenceType === PreferenceType.MAYBE) {
                score += similarity * likedProductScoreMultiplier * 0.5;
              }
            }
          }

          // Process image preferences
          for (let j = 0; j < productImagePreferences.length; j++) {
            const imagePref = productImagePreferences[j];

            if (imagePref.embeddings && imagePref.embeddings.length > 0) {
              // Use the first embedding if there are multiple
              const imageEmbedding = imagePref.embeddings;

              if (imageEmbedding && productEmbedding && imageEmbedding.length > 0) {
                const similarity = calculateCosineSimilarity(productEmbedding, imageEmbedding);

                if (imagePref.imagePreferenceItem?.preferenceType === PreferenceType.LIKE) {
                  score += similarity * likedProductScoreMultiplier;
                } else if (
                  imagePref.imagePreferenceItem?.preferenceType === PreferenceType.DISLIKE
                ) {
                  score -= similarity;
                } else if (
                  imagePref.imagePreferenceItem?.preferenceType === PreferenceType.SUPERLIKE
                ) {
                  score += similarity * likedProductScoreMultiplier * 3;
                } else if (imagePref.imagePreferenceItem?.preferenceType === PreferenceType.MAYBE) {
                  score += similarity * likedProductScoreMultiplier * 0.5;
                }
              }
            }
          }
          // Add original score if applicable
          if (originalScoreMultiplier && 'query' in products[i] && 'score' in products[i]) {
            const productWithScore = products[i] as ProductWithScoreAndSearchQuery;
            score += originalScoreMultiplier * productWithScore.score;
          }

          productScores.push({ score, product: products[i] });
        }

        const rankedProducts = productScores
          .sort((a, b) => b.score - a.score)
          .map((item): ProductWithScoreAndSearchQuery | ProductWithScore => {
            if ('query' in item.product) {
              return {
                product: item.product.product,
                query: item.product.query,
                score: item.score,
              };
            } else {
              return {
                product: item.product,
                score: item.score,
              };
            }
          });

        this.logService.info('Unranked products:', {
          metadata: {
            products: products.map(p => ({
              id: 'query' in p ? p.product?.id : p.id,
              title: 'query' in p ? p.product?.title : p.title,
              url: 'query' in p ? p.product?.url : p.url,
              generatedDescription:
                'query' in p ? p.product?.generatedDescription : p.generatedDescription,
            })),
          },
        });

        this.logService.info('Ranked products:', {
          metadata: {
            products: rankedProducts.map(p => ({
              id: p.product?.id,
              title: p.product?.title,
              url: p.product?.url,
              score: 'score' in p ? p.score : undefined,
              generatedDescription: p.product?.generatedDescription,
            })),
          },
        });

        return rankedProducts;
      } catch (error) {
        this.logService.error('Error reranking products using preferences', {
          metadata: { error, products, userProductPreferences, productImagePreferences },
        });
        return products.map(p => {
          if ('query' in p) {
            return {
              product: p.product,
              query: p.query,
              score: 1,
            };
          } else {
            return {
              product: p,
              score: 1,
            };
          }
        });
      }
    } finally {
      this.perfService.end(perfHandle);
    }
  }

  /**
   * Generate markdown representation of a product.
   */
  getProductMarkdown(product: Product, baseHeading: string = '# Product'): string {
    const markdown = `
${baseHeading} ${product.title}
${product.generatedDescription}

**Metadata:**
- Product Id: ${product.id}
- Price: $${product.price}
- Colors: ${product.colors.join(', ') || 'N/A'}
- Materials: ${product.materials.join(', ') || 'N/A'}
- Style: ${product.style || 'N/A'}
- Fit: ${product.fit || 'N/A'}
`;
    return markdown;
  }

  /**
   * Filter out duplicate products based on their IDs.
   */
  filterDuplicateProducts(
    products: ProductWithScoreAndSearchQuery[],
  ): ProductWithScoreAndSearchQuery[];
  filterDuplicateProducts(products: ProductWithScore[]): ProductWithScore[];
  filterDuplicateProducts(products: ProductWithSearchQuery[]): ProductWithSearchQuery[];
  filterDuplicateProducts(products: Product[]): Product[];
  filterDuplicateProducts(
    products: (
      | Product
      | ProductWithScore
      | ProductWithScoreAndSearchQuery
      | ProductWithSearchQuery
    )[],
  ): (Product | ProductWithScore | ProductWithScoreAndSearchQuery | ProductWithSearchQuery)[] {
    const uniqueProducts: Record<
      string,
      Product | ProductWithScore | ProductWithScoreAndSearchQuery | ProductWithSearchQuery
    > = {};
    for (const product of products) {
      if ('id' in product) {
        uniqueProducts[product.id] = product;
      } else if ('product' in product && product.product && 'id' in product.product) {
        uniqueProducts[product.product.id] = product;
      } else {
        this.logService.warn('Product has no id', { metadata: { product } });
      }
    }
    return Object.values(uniqueProducts);
  }

  /**
   * Remove products that don't have images.
   */
  removeProductsWithoutImages(products: Product[]): Product[];
  removeProductsWithoutImages(products: ProductWithScore[]): ProductWithScore[];
  removeProductsWithoutImages(products: ProductWithSearchQuery[]): ProductWithSearchQuery[];
  removeProductsWithoutImages(
    products: (Product | ProductWithScore | ProductWithSearchQuery)[],
  ): (Product | ProductWithScore | ProductWithSearchQuery)[];
  removeProductsWithoutImages(
    products: (Product | ProductWithScore | ProductWithSearchQuery)[],
  ): (Product | ProductWithScore | ProductWithSearchQuery)[] {
    return products.filter(product => {
      if ('s3ImageUrls' in product) {
        return product.s3ImageUrls && product.s3ImageUrls.length > 0;
      } else if ('product' in product && product.product && 's3ImageUrls' in product.product) {
        return product.product.s3ImageUrls && product.product.s3ImageUrls.length > 0;
      }
      return false;
    });
  }

  async getBrands(): Promise<Brand[]> {
    const dbBrands = await supabaseDb.brands.findMany();
    return dbBrands.map(brand => ({
      id: brand.id,
      company: brand.company,
      url: brand.url,
      gender: brand.gender ? convertDbGenderToGender(brand.gender) : undefined,
      gpt_summary: brand.gpt_summary || undefined,
    }));
  }

  async createBrand(brand: Brand): Promise<Brand> {
    const dbBrand = await supabaseDb.brands.create({
      data: {
        company: brand.company,
        url: brand.url,
        gpt_summary: brand.gptSummary,
      },
    });

    return {
      id: dbBrand.id,
      company: dbBrand.company,
      url: dbBrand.url,
      gptSummary: dbBrand.gpt_summary || undefined,
    };
  }

  async searchForProductsByUrlRegex(urlRegex: string): Promise<Product[]> {
    // Warning: make sure urlRegex is safe or parameter‑bound to avoid SQL injection!
    const dbRows = await supabaseDb.$queryRaw<dbProduct[]>`
      SELECT *
        FROM products_clean
       WHERE url ~ ${urlRegex}    -- Postgres regex match operator
    `;

    return Promise.all(dbRows.map(row => this.convertDbProductToProduct(row)));
  }
}
