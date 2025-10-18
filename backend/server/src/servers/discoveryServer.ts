import {
  GetDiscoveryProductsRequest,
  GetDiscoveryProductsResponse,
  StartDiscoverySessionRequest,
  ContinueDiscoverySessionRequest,
  ContinueDiscoverySessionResponse,
  BookmarkProductRequest,
  BookmarkProductResponse,
  GetBookmarkedProductIdsResponse,
  GetBookmarkedProductIdsRequest,
  UnbookmarkProductRequest,
  UnbookmarkProductResponse,
  StartDiscoverySessionResponse,
  ListBookmarkedProductsResponse,
  ListBookmarkedProductsRequest,
} from '@fetchr/schema/discovery/discovery';
import { DiscoveryServiceImplementation } from '@fetchr/schema/discovery/discovery';
import { discoveryService } from '../fetchr/base/service_injection/global';
import { getRequestUser } from '../fetchr/base/logging/requestContext';

export class DiscoveryServer implements DiscoveryServiceImplementation {
  async getDiscoveryProducts(
    request: GetDiscoveryProductsRequest,
  ): Promise<GetDiscoveryProductsResponse> {
    const user = getRequestUser();
    if (!user) {
      throw new Error('User not found');
    }

    const products = await discoveryService.getDiscoveryProducts(request);

    return {
      products,
    };
  }

  async startDiscoverySession(
    request: StartDiscoverySessionRequest,
  ): Promise<StartDiscoverySessionResponse> {
    const user = getRequestUser();
    if (!user) {
      throw new Error('User not found');
    }

    return await discoveryService.startDiscoverySession(request);
  }

  async continueDiscoverySession(
    request: ContinueDiscoverySessionRequest,
  ): Promise<ContinueDiscoverySessionResponse> {
    const user = getRequestUser();
    if (!user) {
      throw new Error('User not found');
    }

    return await discoveryService.continueDiscoverySession(request);
  }

  async bookmarkProduct(request: BookmarkProductRequest): Promise<BookmarkProductResponse> {
    const user = getRequestUser();
    if (!user) {
      throw new Error('User not found');
    }

    await discoveryService.bookmarkProduct(request);

    return {};
  }

  async unbookmarkProduct(request: UnbookmarkProductRequest): Promise<UnbookmarkProductResponse> {
    const user = getRequestUser();
    if (!user) {
      throw new Error('User not found');
    }

    await discoveryService.unbookmarkProduct(request);

    return {};
  }

  async getBookmarkedProductIds(
    request: GetBookmarkedProductIdsRequest,
  ): Promise<GetBookmarkedProductIdsResponse> {
    const user = getRequestUser();
    if (!user) {
      throw new Error('User not found');
    }

    return await discoveryService.getBookmarkedProductIds(request);
  }

  async listBookmarkedProducts(
    request: ListBookmarkedProductsRequest,
  ): Promise<ListBookmarkedProductsResponse> {
    const user = getRequestUser();
    if (!user) {
      throw new Error('User not found');
    }

    return await discoveryService.listBookmarkedProducts(request);
  }
}
