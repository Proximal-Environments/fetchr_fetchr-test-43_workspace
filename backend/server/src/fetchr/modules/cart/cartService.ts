import { inject, injectable } from 'inversify';
import { supabaseDb } from '../../base/database/supabaseDb';
import { Product } from '@fetchr/schema/base/base';
import { ProductService } from '../product/productService';
import { Cart, OrderCart, OrderCartProduct } from '@fetchr/schema/cart/cart';
import {
  carts as dbCart,
  order_carts as dbOrderCart,
  order_cart_product as dbOrderCartProduct,
} from '@prisma/client';
import { OrderManagementService } from '../orderManagement/orderManagementsService';

@injectable()
export class CartService {
  constructor(
    @inject(ProductService) private readonly productService: ProductService,
    @inject(OrderManagementService) private readonly orderService: OrderManagementService,
  ) {}

  async createCart(userId: string): Promise<Cart> {
    const cart = await supabaseDb.carts.create({
      data: {
        user_id: userId,
        product_ids: [],
      },
    });

    return this.convertDbCartToCart(cart);
  }

  async convertDbCartToCart(cart: dbCart): Promise<Cart> {
    return {
      id: cart.id,
      userId: cart.user_id,
      products: await Promise.all(
        cart.product_ids.map(productId => this.productService.getProductOrFail(productId)),
      ),
      createdAt: cart.created_at,
    };
  }

  async getCartOrCreate(userId: string): Promise<Cart> {
    const cart = await this.getCart(userId);
    if (!cart) {
      return this.createCart(userId);
    }
    return cart;
  }

  async getCart(userId: string): Promise<Cart | null> {
    const cart = await supabaseDb.carts.findFirst({
      where: {
        user_id: userId,
      },
    });

    if (!cart) return null;
    return this.convertDbCartToCart(cart);
  }

  async getCartOrFail(userId: string): Promise<Cart> {
    const cart = await this.getCart(userId);
    if (!cart) throw new Error('Cart not found');
    return cart;
  }

  async clearCart(userId: string): Promise<Cart> {
    const cart = await this.getCart(userId);
    if (cart) {
      await supabaseDb.carts.update({
        where: {
          id: cart.id,
        },
        data: {
          product_ids: [],
          updated_at: new Date(),
        },
      });
    }

    return this.getCartOrFail(userId);
  }

  async addProduct(userId: string, productId: string): Promise<Cart> {
    let cart = await this.getCart(userId);
    if (!cart) {
      cart = await this.createCart(userId);
    }

    await supabaseDb.carts.update({
      where: {
        id: cart.id,
      },
      data: {
        product_ids: [...cart.products.map(p => p.id).filter(id => id !== productId), productId],
        updated_at: new Date(),
      },
    });

    return this.getCartOrFail(userId);
  }

  async removeProduct(userId: string, productId: string): Promise<Cart> {
    const cart = await this.getCartOrFail(userId);

    await supabaseDb.carts.update({
      where: {
        id: cart.id,
      },
      data: {
        product_ids: cart.products.map(p => p.id).filter(id => id !== productId),
        updated_at: new Date(),
      },
    });

    return this.getCartOrFail(userId);
  }

  async getCartProducts(userId: string): Promise<Product[]> {
    const cart = await this.getCart(userId);
    if (!cart) return [];
    return cart.products;
  }

  async getOrderCart(orderId: string): Promise<OrderCart> {
    const cart = await supabaseDb.order_carts.findFirst({
      where: {
        order_id: orderId,
      },
      include: {
        order_cart_product: true,
      },
    });

    if (!cart) {
      return this.createOrderCart(orderId);
    }
    return this.convertDbOrderCartToOrderCart(cart);
  }

  async clearOrderCart(orderId: string): Promise<OrderCart> {
    const cart = await this.getOrderCart(orderId);
    await supabaseDb.order_carts.delete({
      where: {
        id: cart.id,
      },
    });

    return this.getOrderCart(orderId);
  }

  async addProductToOrderCart(orderId: string, productId: string): Promise<OrderCart> {
    const cart = await this.getOrderCart(orderId);
    const product = await this.productService.getProduct(productId);
    if (!product) throw new Error('Product not found');
    await supabaseDb.order_cart_product.create({
      data: {
        order_cart_id: cart.id,
        product_id: productId,
        current_price: product.price,
        original_price: product.originalPrice,
        chosen_color: product.colors[0] ?? null,
      },
    });

    return this.getOrderCart(orderId);
  }

  async removeProductFromOrderCart(orderId: string, productId: string): Promise<OrderCart> {
    const cart = await this.getOrderCart(orderId);
    await supabaseDb.order_cart_product.deleteMany({
      where: {
        order_cart_id: cart.id,
        product_id: productId,
      },
    });

    return this.getOrderCart(orderId);
  }

  async updateProductInOrderCart(
    orderId: string,
    productId: string,
    recommendedSize: string | undefined,
    originalPrice: number | undefined,
    currentPrice: number | undefined,
    recommendedColor: string | undefined,
  ): Promise<OrderCart> {
    const cart = await this.getOrderCart(orderId);
    const data: Record<string, string | number | undefined> = {};

    if (recommendedSize !== undefined) {
      data.chosen_size = recommendedSize;
    }
    if (originalPrice !== undefined) {
      data.original_price = originalPrice === currentPrice ? undefined : originalPrice;
    }
    if (currentPrice !== undefined) {
      data.current_price = currentPrice;
    }
    if (recommendedColor !== undefined) {
      data.chosen_color = recommendedColor;
    }

    const orderCartProduct = await supabaseDb.order_cart_product.findFirst({
      where: {
        order_cart_id: cart.id,
        product_id: productId,
      },
    });

    if (!orderCartProduct) {
      throw new Error('Product not found in order cart');
    }

    await supabaseDb.order_cart_product.update({
      where: {
        id: orderCartProduct.id,
      },
      data,
    });

    return this.getOrderCart(orderId);
  }

  async createOrderCart(orderId: string): Promise<OrderCart> {
    const cart = await supabaseDb.order_carts.create({
      data: {
        order_id: orderId,
        product_ids: [],
      },
      include: {
        order_cart_product: true,
      },
    });

    return this.convertDbOrderCartToOrderCart(cart);
  }

  async convertDbOrderCartToOrderCart(
    cart: dbOrderCart & { order_cart_product: dbOrderCartProduct[] },
  ): Promise<OrderCart> {
    const order = await this.orderService.getOrder(cart.order_id);
    if (!order) throw new Error('Order not found');
    return {
      id: cart.id,
      orderId: cart.order_id,
      products: (
        await Promise.all(
          cart.order_cart_product.map(async cartProduct => {
            const product = await this.productService.getProduct(cartProduct.product_id);
            if (!product) return null;

            const orderCartProduct: OrderCartProduct = {
              product: product,
              recommendedSize: cartProduct.chosen_size ?? undefined,
              currentPrice: cartProduct.current_price,
              originalPrice: cartProduct.original_price ?? undefined,
            };

            return orderCartProduct;
          }),
        )
      ).filter((product): product is OrderCartProduct => product !== null), // We remove archived / deleted products automatically here
    };
  }

  async addOrderSuggestionItemsToCart(
    orderId: string,
    orderSuggestionId: string,
  ): Promise<OrderCart> {
    const orderSuggestion = await this.orderService.getOrderSuggestion(orderSuggestionId);
    if (!orderSuggestion) throw new Error('Order suggestion not found');
    await Promise.all(
      orderSuggestion.productSuggestions.map(async productSuggestion => {
        await this.addProductToOrderCart(orderId, productSuggestion.productId);
        await this.updateProductInOrderCart(
          orderId,
          productSuggestion.productId,
          productSuggestion.size,
          productSuggestion.originalPrice,
          productSuggestion.price,
          productSuggestion.color,
        );
      }),
    );

    return this.getOrderCart(orderId);
  }
}
