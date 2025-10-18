import { Product } from '@fetchr/schema/base/base';
import { BaseService } from '../../base/service_injection/baseService';
import { inject, injectable } from 'inversify';
import { ProductService } from '../product/productService';

@injectable()
export class MockService extends BaseService {
  constructor(@inject(ProductService) private productService: ProductService) {
    super('MockService');
  }

  async getMockProducts(count: number): Promise<Product[]> {
    const products = await this.productService.getSampleProducts(count);
    return products;
  }

  private generateRandomId(): string {
    return 'mock-' + Math.random().toString(36).substring(2, 15);
  }
}
