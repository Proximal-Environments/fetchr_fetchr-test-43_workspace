import { cartService } from '../fetchr/base/service_injection/global';
import {
  CartServiceImplementation,
  CreateCartRequest,
  GetCartRequest,
  ClearCartRequest,
  AddProductRequest,
  RemoveProductRequest,
  ClearCartResponse,
  CreateCartResponse,
  RemoveProductResponse,
  GetCartProductsResponse,
  GetCartResponse,
  AddProductResponse,
  GetOrderCartRequest,
  GetOrderCartResponse,
  AddProductToOrderCartResponse,
  AddProductToOrderCartRequest,
  ClearOrderCartResponse,
  ClearOrderCartRequest,
  RemoveProductFromOrderCartResponse,
  RemoveProductFromOrderCartRequest,
  UpdateProductInOrderCartRequest,
  UpdateProductInOrderCartResponse,
  AddOrderSuggestionItemsToCartRequest,
  AddOrderSuggestionItemsToCartResponse,
} from '@fetchr/schema/cart/cart';

export class CartServer implements CartServiceImplementation {
  async createCart(request: CreateCartRequest): Promise<CreateCartResponse> {
    const cart = await cartService.createCart(request.userId);

    return {
      cart: cart,
    };
  }

  async getCart(request: GetCartRequest): Promise<GetCartResponse> {
    const cart = await cartService.getCartOrCreate(request.userId);

    return {
      cart: cart,
    };
  }

  async clearCart(request: ClearCartRequest): Promise<ClearCartResponse> {
    const cart = await cartService.clearCart(request.userId);
    return {
      cart: cart,
    };
  }

  async addProduct(request: AddProductRequest): Promise<AddProductResponse> {
    const cart = await cartService.addProduct(request.userId, request.productId);

    return {
      cart: cart,
    };
  }

  async removeProduct(request: RemoveProductRequest): Promise<RemoveProductResponse> {
    const cart = await cartService.removeProduct(request.userId, request.productId);
    if (!cart) throw new Error('Cart not found');
    return {
      cart: cart,
    };
  }

  async getCartProducts(request: GetCartRequest): Promise<GetCartProductsResponse> {
    const products = await cartService.getCartProducts(request.userId);
    return {
      products: products,
    };
  }

  async getOrderCart(request: GetOrderCartRequest): Promise<GetOrderCartResponse> {
    const orderCart = await cartService.getOrderCart(request.orderId);
    return {
      orderCart: orderCart,
    };
  }

  async addProductToOrderCart(
    request: AddProductToOrderCartRequest,
  ): Promise<AddProductToOrderCartResponse> {
    const orderCart = await cartService.addProductToOrderCart(request.orderId, request.productId);
    return {
      orderCart: orderCart,
    };
  }

  async clearOrderCart(request: ClearOrderCartRequest): Promise<ClearOrderCartResponse> {
    const orderCart = await cartService.clearOrderCart(request.orderId);
    return {
      orderCart: orderCart,
    };
  }

  async removeProductFromOrderCart(
    request: RemoveProductFromOrderCartRequest,
  ): Promise<RemoveProductFromOrderCartResponse> {
    const orderCart = await cartService.removeProductFromOrderCart(
      request.orderId,
      request.productId,
    );
    return {
      orderCart: orderCart,
    };
  }

  async updateProductInOrderCart(
    request: UpdateProductInOrderCartRequest,
  ): Promise<UpdateProductInOrderCartResponse> {
    const orderCart = await cartService.updateProductInOrderCart(
      request.orderId,
      request.productId,
      request.recommendedSize,
      request.originalPrice,
      request.currentPrice,
      request.recommendedColor,
    );
    return { orderCart: orderCart };
  }

  async addOrderSuggestionItemsToCart(
    request: AddOrderSuggestionItemsToCartRequest,
  ): Promise<AddOrderSuggestionItemsToCartResponse> {
    const orderCart = await cartService.addOrderSuggestionItemsToCart(
      request.orderId,
      request.orderSuggestionId,
    );
    return { orderCart: orderCart };
  }
}
