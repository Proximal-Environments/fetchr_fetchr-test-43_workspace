import { MockServiceImplementation } from '@fetchr/schema/mock/mock';
import { GetMockProductsRequest, GetMockProductsResponse } from '@fetchr/schema/mock/mock';
import { mockService } from '../fetchr/base/service_injection/global';

export class MockServer implements MockServiceImplementation {
  async getMockProducts(request: GetMockProductsRequest): Promise<GetMockProductsResponse> {
    const products = await mockService.getMockProducts(request.count);

    return {
      products,
    };
  }
}
