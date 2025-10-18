import { injectable } from 'inversify';
import { BaseService } from '../../base/service_injection/baseService';
import { supabaseDb } from '../../base/database/supabaseDb';
import { logService } from '../../base/logging/logService';
import { style_picker_products as dbStylePickerProduct, gender } from '@prisma/client';
import {
  convertCategoryToDbCategory,
  convertDbCategoryToCategory,
} from '../../../shared/converters';
import { ProductCategory } from '@fetchr/schema/base/base';

export interface StylePickerProduct {
  id: string;
  modelImage: string;
  stickerImage: string;
  category?: ProductCategory;
  gender?: gender | null;
}

@injectable()
export class StylePickerProductService extends BaseService {
  constructor() {
    super('StylePickerProductService', logService);
    this.logService.info('[StylePickerProductService] Service initialized');
  }

  private convertDbProductToStylePickerProduct(
    dbProduct: dbStylePickerProduct,
  ): StylePickerProduct {
    return {
      id: dbProduct.id,
      modelImage: dbProduct.model_image || '',
      stickerImage: dbProduct.sticker_image || '',
      category: dbProduct.category ? convertDbCategoryToCategory(dbProduct.category) : undefined,
      gender: dbProduct.gender,
    };
  }

  private convertStylePickerProductToDbProduct(
    product: Partial<StylePickerProduct>,
  ): Partial<dbStylePickerProduct> {
    return {
      ...(product.id && { id: product.id }),
      ...(product.modelImage && { model_image: product.modelImage }),
      ...(product.stickerImage && { sticker_image: product.stickerImage }),
      ...(product.category && { category: convertCategoryToDbCategory(product.category) }),
      ...(product.gender !== undefined && { gender: product.gender }),
    };
  }

  async getStylePickerProduct(productId: string): Promise<StylePickerProduct | null> {
    try {
      const productData = await supabaseDb.style_picker_products.findUnique({
        where: { id: productId },
      });

      if (!productData) {
        return null;
      }

      return this.convertDbProductToStylePickerProduct(productData);
    } catch (error) {
      this.logService.error(`Error fetching style picker product ${productId}: ${error}`);
      return null;
    }
  }

  async listStylePickerProducts({
    limit = 10,
    offset = 0,
    category,
    gender,
  }: {
    limit?: number;
    offset?: number;
    category?: ProductCategory;
    gender?: gender;
  }): Promise<StylePickerProduct[]> {
    this.logService.info(
      `[StylePickerProductService] Attempting to list products with limit: ${limit}, offset: ${offset}, category: ${category}, gender: ${gender}`,
    );
    try {
      const where = {
        ...(category && { category: convertCategoryToDbCategory(category) }),
        ...(gender && { gender }),
      };

      const products = await supabaseDb.style_picker_products.findMany({
        where: Object.keys(where).length > 0 ? where : undefined,
        skip: offset,
        take: limit,
      });

      this.logService.info(
        `[StylePickerProductService] Successfully fetched ${products.length} products`,
      );
      return products.map(product => this.convertDbProductToStylePickerProduct(product));
    } catch (error) {
      this.logService.error(
        `[StylePickerProductService] Error listing style picker products: ${error}`,
      );
      return [];
    }
  }

  async getTotalCount({
    category,
    gender,
  }: {
    category?: ProductCategory;
    gender?: gender;
  }): Promise<number> {
    try {
      const where = {
        ...(category && { category: convertCategoryToDbCategory(category) }),
        ...(gender && { gender }),
      };
      return await supabaseDb.style_picker_products.count({
        where: Object.keys(where).length > 0 ? where : undefined,
      });
    } catch (error) {
      this.logService.error(`Error counting style picker products: ${error}`);
      return 0;
    }
  }

  async insertStylePickerProduct(
    product: Omit<StylePickerProduct, 'id'>,
  ): Promise<StylePickerProduct | null> {
    try {
      const dbProduct = this.convertStylePickerProductToDbProduct(product);
      const created = await supabaseDb.style_picker_products.create({
        data: dbProduct as dbStylePickerProduct,
      });
      this.logService.info(`Successfully inserted style picker product ${created.id}`);
      return this.convertDbProductToStylePickerProduct(created);
    } catch (error) {
      this.logService.error(`Error inserting style picker product: ${error}`);
      return null;
    }
  }

  async updateStylePickerProduct(
    productId: string,
    update: Partial<StylePickerProduct>,
  ): Promise<StylePickerProduct | null> {
    try {
      const dbUpdate = this.convertStylePickerProductToDbProduct(update);
      const updated = await supabaseDb.style_picker_products.update({
        where: { id: productId },
        data: dbUpdate,
      });

      return this.convertDbProductToStylePickerProduct(updated);
    } catch (error) {
      this.logService.error(`Error updating style picker product ${productId}: ${error}`);
      return null;
    }
  }

  async deleteStylePickerProduct(productId: string): Promise<boolean> {
    try {
      await supabaseDb.style_picker_products.delete({
        where: { id: productId },
      });
      return true;
    } catch (error) {
      this.logService.error(`Error deleting style picker product ${productId}: ${error}`);
      return false;
    }
  }
}
