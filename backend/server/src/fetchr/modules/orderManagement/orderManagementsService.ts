import { injectable, inject } from 'inversify';
import { BaseService } from '../../base/service_injection/baseService';
import { supabaseDb } from '../../base/database/supabaseDb';
import { ServerError, Status } from 'nice-grpc';
import {
  order_lifecycle_status,
  order_suggestion_status,
  orders_v2,
  Prisma,
  product_purchase,
  product_purchase_suggestion,
  public_users,
} from '@prisma/client';
import {
  AddProductSuggestionToOrderSuggestionRequest,
  AddProductSuggestionToOrderSuggestionResponse,
  AddShipmentToOrderSuggestionRequest,
  CreateOrderSuggestionRequest,
  DeleteOrderSuggestionsRequest,
  DeleteOrderSuggestionsResponse,
  FinalizeOrderSuggestionRequest,
  FinalizeOrderSuggestionResponse,
  PublishDraftSuggestionRequest,
  PublishDraftSuggestionResponse,
  RemoveProductSuggestionFromOrderSuggestionRequest,
  RemoveProductSuggestionFromOrderSuggestionResponse,
  ReplaceOrderSuggestionRequest,
  ReplaceOrderSuggestionResponse,
  SubmitOrderSuggestionUserResponseRequest,
  SubmitProductPurchaseFeedbackRequest,
  SubmitProductPurchaseSuggestionFeedbackRequest,
  SubmitProductPurchaseSuggestionFeedbackResponse,
  UpdateOrderSuggestionStylistNoteRequest,
  UpdateOrderSuggestionStylistNoteResponse,
  UpdateProductPurchaseRequest,
  UpdateProductPurchaseResponse,
  UpdateShippingInformationRequest,
  ToggleProductPurchaseSuggestionArchivedRequest,
  ToggleProductPurchaseSuggestionArchivedResponse,
  EditProductPurchaseSuggestionRequest,
  EditProductPurchaseSuggestionResponse,
} from '@fetchr/schema/orderManagement/orderManagement';
import {
  convertDbOrderStatusToOrderStatus,
  convertDbShipmentStatusToShipmentStatus,
  convertOrderStatusToDbOrderStatus,
  convertProductPurchaseFeedbackCategoryToDbProductPurchaseFeedbackCategory,
  convertShipmentStatusToDbShipmentStatus,
  convertDbOrderTypeToProtoOrderType,
  convertProtoOrderTypeToDbOrderType,
  convertProductPurchaseRefundStatusToDbProductPurchaseRefundStatus,
  convertPaymentStatusToDbPaymentStatus,
} from '../../../shared/converters';
import { SlackService, UserInfo } from '../slack/slackService';
import {
  OrderStatus,
  OrderSuggestionStatus,
  OrderSummary,
  OrderType,
  PopulatedOrderSuggestion,
  ProductPurchaseSuggestionStatus,
  ProductRecommendation,
  Shipment,
  ShipmentStatus,
  UserProfile,
  UserRole,
} from '@fetchr/schema/base/base';
import { EnrichedOrderDetail } from '@fetchr/schema/orderManagement/orderManagement';
import { ExploreRequestService } from '../explore/exploreRequestService';
import {
  convertDbProductRecommendationsToProductRecommendations,
  convertProductRecommendationsToDbProductRecommendations,
} from '../../core/agent/looped_agent/orderManagement/orderManagementConverters';
import { ProductService } from '../product/productService';
import { getRequestUser } from '../../base/logging/requestContext';
import { EmailService } from '../../core/email/emailService';
import { NotificationsService } from '../notifications/notificationsService';
import { NOTIFICATION_TYPE } from '../../../shared/notifications';
import { ProductSearchService } from '../product/productSearchService';
import { OpenAIService } from '../../core/open_ai/openaiService';
import { BillingService } from '../billing/billingService';
import { UserService } from '../user/userService';
import { countryToAlpha2 } from 'country-to-iso';
import { PaymentMethodStatus } from '@fetchr/schema/base/user_billing';
import { getOrderSuggestionDates } from '../../base/orderUtils/orderDates';

export const REDIS_ENABLED_FOR_ORDER_MANAGEMENT_SERVICE = false;

// CACHING: Import Redis service and configs
import { CACHE_CONFIGS, RedisService } from '../../core/redis/redisService';
import {
  convertDbOrderSuggestionsToOrderSuggestion,
  convertDbProductPurchaseSuggestionToProductPurchaseSuggestion,
  convertDbProductPurchaseToProductPurchase,
  convertDbShipmentToShipment,
  convertDbShipmentToShipmentBatch,
} from './orderManagementConverters';
import { BrexService } from '../../core/brex/brexService';
import { tasks } from '@trigger.dev/sdk/v3';
import { JudgeOrderSuggestionPayload } from '../../../trigger/payloads';
import { taskIds } from '../../../trigger/task_ids';
import { isAppStoreReviewerEmail } from '../../../shared/appStoreReview';

@injectable()
export class OrderManagementService extends BaseService {
  constructor(
    @inject(SlackService) private slackService: SlackService,
    @inject(ProductService) private productService: ProductService,
    @inject(EmailService) private emailService: EmailService,
    @inject(NotificationsService) private notificationsService: NotificationsService,
    @inject(ExploreRequestService) private exploreRequestService: ExploreRequestService,
    @inject(ProductSearchService) private productSearchService: ProductSearchService,
    @inject(OpenAIService) private openaiService: OpenAIService,
    @inject(RedisService) private redisService: RedisService,
    @inject(BillingService) private billingService: BillingService,
    @inject(UserService) private profileService: UserService,
    @inject(BrexService) private brexService: BrexService,
  ) {
    super('OrderManagementService');
  }

  private async convertToOrderSummaryBatch(
    orders: (orders_v2 & {
      users_orders_v2_customer_idTousers: public_users;
      users_orders_v2_stylist_idTousers: public_users | null;
    })[],
  ): Promise<OrderSummary[]> {
    const customerIds = orders.map(order => order.customer_id);
    const stylistIds = orders.map(order => order.stylist_id).filter((id): id is string => !!id);

    const userIds = [...customerIds, ...stylistIds];
    const userProfiles = await this.profileService.getProfiles(userIds);
    const userProfilesMap = new Map<string, UserProfile>();
    userProfiles.forEach(profile => {
      userProfilesMap.set(profile.id, profile);
    });

    // Fetch generated titles for all orders with chat IDs
    const chatIds = orders.map(order => order.chat_id).filter((id): id is string => !!id);
    const generatedTitlesMap = await this.exploreRequestService.getGeneratedTitlesBatch(chatIds);

    const orderIds = orders.map(order => order.id);
    const orderSuggestions = await supabaseDb.order_suggestion.findMany({
      where: {
        order_id: {
          in: orderIds,
        },
      },
      include: {
        product_purchase_suggestion: {
          include: {
            products_clean: true,
            product_purchase_suggestion_thread: {
              include: {
                threads: {
                  include: {
                    thread_messages: true,
                  },
                },
              },
            },
          },
        },
        shipment: {
          include: {
            product_purchase: {
              include: {
                products_clean: true,
              },
            },
            brands: true,
          },
        },
      },
      orderBy: {
        created_at: 'desc',
      },
    });

    const orderSuggestionsMap = new Map<string, typeof orderSuggestions>();
    orderSuggestions.forEach(suggestion => {
      const suggestions = orderSuggestionsMap.get(suggestion.order_id) || [];
      suggestions.push(suggestion);
      orderSuggestionsMap.set(suggestion.order_id, suggestions);
    });

    // Batch convert all order suggestions
    const convertedOrderSuggestions = await Promise.all(
      orderSuggestions.map(convertDbOrderSuggestionsToOrderSuggestion),
    );

    // Create a map of order ID to converted suggestions
    const convertedOrderSuggestionsMap = new Map<string, PopulatedOrderSuggestion[]>();
    convertedOrderSuggestions.forEach((convertedSuggestion, index) => {
      const orderId = orderSuggestions[index].order_id;
      const suggestions = convertedOrderSuggestionsMap.get(orderId) || [];
      suggestions.push(convertedSuggestion);
      convertedOrderSuggestionsMap.set(orderId, suggestions);
    });

    return orders
      .map((order): OrderSummary | undefined => {
        return {
          id: order.id,
          customerId: order.customer_id,
          stylistId: order.stylist_id ?? undefined,
          chatId: order.chat_id ?? undefined,
          stylist: order.stylist_id ? userProfilesMap.get(order.stylist_id) : undefined,
          orderSuggestions: convertedOrderSuggestionsMap.get(order.id) || [],
          status: convertDbOrderStatusToOrderStatus(order.status),
          createdAt: Math.floor(order.created_at.getTime() / 1000),
          updatedAt: Math.floor(order.updated_at.getTime() / 1000),
          customer: userProfilesMap.get(order.customer_id),
          userViewVersion: order.user_view_version,
          dashboardMetadata: {
            isStarred: order.is_starred,
          },
          productRecommendations: convertDbProductRecommendationsToProductRecommendations(
            order?.product_recommendations ?? [],
          ),
          note: order.note ?? undefined,
          generatedTitle: order.chat_id ? generatedTitlesMap.get(order.chat_id) : undefined,
          type: convertDbOrderTypeToProtoOrderType(order.type),
        };
      })
      .filter(order => order !== undefined);
  }

  private async convertToOrderSummary(
    order: orders_v2 & {
      users_orders_v2_customer_idTousers: public_users;
      users_orders_v2_stylist_idTousers: public_users | null;
    },
  ): Promise<OrderSummary> {
    const currentUser = getRequestUser();

    // Get generated title efficiently using batch method with single chat ID
    const generatedTitlesMap = order.chat_id
      ? await this.exploreRequestService.getGeneratedTitlesBatch([order.chat_id])
      : new Map<string, string>();

    const [userProfile, stylistProfile] = await Promise.all([
      currentUser && order.customer_id === currentUser.id
        ? currentUser
        : this.profileService.getProfile(order.customer_id),
      order.stylist_id
        ? currentUser && order.stylist_id === currentUser.id
          ? currentUser
          : this.profileService.getProfile(order.stylist_id)
        : Promise.resolve(undefined),
    ]);

    const orderSuggestions = await supabaseDb.order_suggestion.findMany({
      where: {
        order_id: order.id,
      },
      include: {
        product_purchase_suggestion: {
          include: {
            products_clean: true,
            product_purchase_suggestion_thread: {
              include: {
                threads: {
                  include: {
                    thread_messages: true,
                  },
                },
              },
            },
          },
        },
        shipment: {
          include: {
            product_purchase: {
              include: {
                products_clean: true,
              },
            },
            brands: true,
          },
        },
      },
      orderBy: {
        created_at: 'desc',
      },
    });

    const convertedOrderSummary = {
      id: order.id,
      customerId: order.customer_id,
      stylistId: order.stylist_id ?? undefined,
      chatId: order.chat_id ?? undefined,
      status: convertDbOrderStatusToOrderStatus(order.status),
      createdAt: Math.floor(order.created_at.getTime() / 1000),
      updatedAt: Math.floor(order.updated_at.getTime() / 1000),
      customer: userProfile ?? undefined,
      stylist: stylistProfile ?? undefined,
      userViewVersion: order.user_view_version,
      type: convertDbOrderTypeToProtoOrderType(order.type),
      dashboardMetadata: {
        isStarred: order.is_starred,
      },
      productRecommendations: convertDbProductRecommendationsToProductRecommendations(
        order?.product_recommendations ?? [],
      ),
      note: order.note ?? undefined,
      generatedTitle: order.chat_id ? generatedTitlesMap.get(order.chat_id) : undefined,
      orderSuggestions: await Promise.all(
        orderSuggestions.map(convertDbOrderSuggestionsToOrderSuggestion),
      ),
    };

    return convertedOrderSummary;
  }

  async createOrder(
    customerId: string,
    productRecommendations: ProductRecommendation[],
    chatId: string | undefined,
    stylistId?: string,
    note?: string,
    type?: OrderType,
  ): Promise<OrderSummary> {
    let orderId = undefined;
    try {
      const order = await supabaseDb.orders_v2.create({
        data: {
          customer_id: customerId,
          stylist_id: stylistId,
          chat_id: chatId,
          product_recommendations:
            convertProductRecommendationsToDbProductRecommendations(productRecommendations),
          note: note,
          type: convertProtoOrderTypeToDbOrderType(type),
        },
        include: {
          users_orders_v2_customer_idTousers: true,
          users_orders_v2_stylist_idTousers: true,
        },
      });
      orderId = order.id;
      const orderSummary = await this.convertToOrderSummary(order);

      if (process.env.SLACK_STYLISTS_CHANNEL_ID && type !== OrderType.ORDER_TYPE_FETCHR_INITIATED) {
        const currentUser = getRequestUser();
        const isTestOrder = isAppStoreReviewerEmail(currentUser?.email ?? '');

        const customerInfo: UserInfo = {
          id: orderSummary.customer?.id,
          name: orderSummary.customer?.name,
          email: orderSummary.customer?.email,
          phoneNumber: orderSummary.customer?.phoneNumber,
        };

        const additionalBlocks = [
          {
            type: 'section' as const,
            text: {
              type: 'mrkdwn' as const,
              text: `*Order Details:*\n• Order ID: ${order.id}\n• Chat ID: ${
                chatId || 'N/A'
              }\n• Order URL: https://admin.fetchr.so/orders/${order.id}${
                isTestOrder ? '\n• ⚠️ APP STORE REVIEWER TEST ORDER' : ''
              }`,
            },
          },
        ];

        await this.slackService.sendMessageWithUserInfo(
          process.env.SLACK_STYLISTS_CHANNEL_ID,
          '🛍️ *New Order Created*',
          customerInfo,
          {
            userLabel: 'Customer',
            additionalBlocks,
          },
        );
      }

      if (chatId) {
        this.exploreRequestService.updateGeneratedTitle(chatId);
        this.exploreRequestService.updateUserProfileFromRequest(chatId);
      }

      if (type !== OrderType.ORDER_TYPE_FETCHR_INITIATED) {
        this.emailService.sendEmail({
          to: orderSummary.customer?.email ?? '',
          subject: 'Order Confirmation',
          html: `
        <div style="font-family: sans-serif; color: #333;">
          <p>Hey ${
            orderSummary.customer?.name?.firstName ? orderSummary.customer.name.firstName : 'there'
          }!</p>
          
          <p>Thanks for placing an order with Fetchr! We'll start looking for the perfect product for you right away.</p>

          <p style="margin-top: 24px;">P.S. If you have any questions or need help with anything, feel free to text us at <a href="sms:+14159354678&body=Hi, I have a question about my order" style="color: #007bff; text-decoration: none;">+14159354678</a>.</p>
        </div>
        `,
        });
      }

      // CACHING: Store new order in all relevant caches
      if (REDIS_ENABLED_FOR_ORDER_MANAGEMENT_SERVICE) {
        await Promise.all([
          this.redisService.set(`order:${order.id}`, orderSummary, CACHE_CONFIGS.USER),
          this.redisService.set(`order:chatId:${chatId}`, orderSummary, CACHE_CONFIGS.USER),
          this.redisService.set(`order:${order.id}`, orderSummary),
          this.redisService.set(`order:chatId:${chatId}`, orderSummary),
        ]);
      }

      return orderSummary;
    } catch (error) {
      this.logService.error('Error creating order', {
        metadata: { customerId, stylistId, chatId },
        error,
      });
      throw error;
    } finally {
      const requestUser = getRequestUser();
      if (requestUser?.email && isAppStoreReviewerEmail(requestUser.email) && orderId) {
        this.sendSampleOrderSuggestion(orderId);
      }
    }
  }

  async sendSampleOrderSuggestion(orderId: string): Promise<void> {
    try {
      this.logService.debug(`Sending sample order suggestion for order: ${orderId}`);
      const sampleProduct = await this.productService.getSampleProduct();
      await this.createOrderSuggestion({
        isAutoAccepted: false,
        isDraft: false,
        orderId,
        productPurchases: [
          {
            color: sampleProduct.colors[0],
            productId: sampleProduct.id,
            size: sampleProduct.sizes[0],
            price: sampleProduct.price,
          },
        ],
      });
    } catch (error) {
      this.logService.error('Error creating sample order suggestion for app store reviewer', {
        metadata: { orderId },
        error,
      });
    }
  }

  async updateOrderCache(orderId: string): Promise<void> {
    try {
      if (!REDIS_ENABLED_FOR_ORDER_MANAGEMENT_SERVICE) {
        return;
      }

      const cacheKey = `order:${orderId}`;
      const dbOrder = await supabaseDb.orders_v2.findUnique({
        where: { id: orderId },
        include: {
          users_orders_v2_customer_idTousers: true,
          users_orders_v2_stylist_idTousers: true,
        },
      });

      if (dbOrder) {
        const updatedOrder = await this.convertToOrderSummary(dbOrder);
        await this.redisService.set(cacheKey, updatedOrder, CACHE_CONFIGS.USER);
      }
    } catch (error) {
      this.logService.error('Error updating order cache', {
        metadata: { orderId },
        error,
      });
    }
  }

  async getOrdersByCustomerId(customerId: string): Promise<OrderSummary[]> {
    const orders = await supabaseDb.orders_v2.findMany({
      where: { customer_id: customerId },
      include: {
        users_orders_v2_customer_idTousers: true,
        users_orders_v2_stylist_idTousers: true,
      },
    });
    return Promise.all(
      orders.map(order =>
        this.convertToOrderSummary(order).catch(error => {
          this.logService.error('Error converting order to summary', {
            metadata: { orderId: order.id },
            error,
          });
          return null;
        }),
      ),
    ).then(orderSummaries => orderSummaries.filter(Boolean) as OrderSummary[]);
  }

  async getOrderByChatId(chatId: string): Promise<OrderSummary | null> {
    try {
      const dbOrder = await supabaseDb.orders_v2.findFirst({
        where: { chat_id: chatId },
        include: {
          users_orders_v2_customer_idTousers: true,
          users_orders_v2_stylist_idTousers: true,
        },
      });

      if (!dbOrder) {
        return null;
      }

      return this.convertToOrderSummary(dbOrder);
    } catch (error) {
      this.logService.error('Error getting order by chat ID', { metadata: { chatId }, error });
      throw error;
    }
  }

  async getOrder(orderId: string): Promise<OrderSummary> {
    try {
      // CACHING: Check cache first
      const cacheKey = `order:${orderId}`;
      let order = REDIS_ENABLED_FOR_ORDER_MANAGEMENT_SERVICE
        ? await this.redisService.get<OrderSummary>(cacheKey, CACHE_CONFIGS.USER)
        : undefined;

      if (!order) {
        // Fetch from DB
        const dbOrder = await supabaseDb.orders_v2.findUnique({
          where: { id: orderId },
          include: {
            users_orders_v2_customer_idTousers: true,
            users_orders_v2_stylist_idTousers: true,
          },
        });

        if (!dbOrder) {
          throw new ServerError(Status.NOT_FOUND, `Order ${orderId} not found`);
        }

        order = await this.convertToOrderSummary(dbOrder);
        if (REDIS_ENABLED_FOR_ORDER_MANAGEMENT_SERVICE) {
          await this.redisService.set(cacheKey, order, CACHE_CONFIGS.USER);
        }
      } else {
        // Asynchronously update the cache without blocking the response
        if (REDIS_ENABLED_FOR_ORDER_MANAGEMENT_SERVICE) {
          Promise.resolve().then(async () => {
            await this.updateOrderCache(orderId);
          });
        }
      }

      return order;
    } catch (error) {
      this.logService.error('Error getting order', { metadata: { orderId }, error });
      throw error;
    }
  }

  async listOrders(
    customerId?: string,
    stylistId?: string,
    status?: order_lifecycle_status,
    shouldIncludeArchivedSuggestions: boolean = true,
  ): Promise<OrderSummary[]> {
    try {
      // If Redis is enabled, try to get from cache first
      if (REDIS_ENABLED_FOR_ORDER_MANAGEMENT_SERVICE) {
        const cacheKey = `orders:${customerId || 'all'}:${stylistId || 'all'}:${status || 'all'}`;
        const cached = await this.redisService.get<OrderSummary[]>(cacheKey, CACHE_CONFIGS.USER);
        if (cached) {
          // Start background refresh without awaiting it
          this.refreshOrdersCacheInBackground(customerId, stylistId, status, cacheKey);
          return cached;
        }
      }

      // Fetch from DB
      const orders = await supabaseDb.orders_v2.findMany({
        where: {
          ...(customerId && { customer_id: customerId }),
          ...(stylistId && { stylist_id: stylistId }),
          ...(status && { status: status }),
        },
        include: {
          users_orders_v2_customer_idTousers: true,
          users_orders_v2_stylist_idTousers: true,
        },
        orderBy: {
          created_at: 'desc',
        },
      });

      let orderSummaries = await this.convertToOrderSummaryBatch(orders).catch(error => {
        this.logService.error('Error converting orders to summaries', {
          metadata: { orderIds: orders.map(o => o.id) },
          error,
        });
        return [];
      });

      if (shouldIncludeArchivedSuggestions === false) {
        orderSummaries = orderSummaries.map(order => {
          return {
            ...order,
            orderSuggestions: order.orderSuggestions
              ?.filter(
                suggestion =>
                  suggestion.status !== OrderSuggestionStatus.ORDER_SUGGESTION_STATUS_ARCHIVED &&
                  suggestion.status !== OrderSuggestionStatus.ORDER_SUGGESTION_STATUS_DRAFT,
              )
              .map(orderSuggestion => ({
                ...orderSuggestion,
                productSuggestions: orderSuggestion.productSuggestions?.filter(
                  productSuggestion => !productSuggestion.isArchived,
                ),
                productPurchases: orderSuggestion.shipments
                  .map(shipment => ({
                    ...shipment,
                    productPurchases: shipment.productPurchases?.filter(
                      productPurchase => !productPurchase.isArchived,
                    ),
                  }))
                  .flat(),
              })),
          };
        });
      }

      // Store in cache if Redis is enabled
      if (REDIS_ENABLED_FOR_ORDER_MANAGEMENT_SERVICE) {
        const cacheKey = `orders:${customerId || 'all'}:${stylistId || 'all'}:${status || 'all'}`;
        await this.redisService.set(cacheKey, orderSummaries, CACHE_CONFIGS.USER);
      }

      return orderSummaries;
    } catch (error) {
      this.logService.error('Error listing orders', {
        metadata: { customerId, stylistId, status },
        error,
      });
      throw error;
    }
  }

  private async refreshOrdersCacheInBackground(
    customerId?: string,
    stylistId?: string,
    status?: order_lifecycle_status,
    cacheKey?: string,
  ): Promise<void> {
    try {
      if (!REDIS_ENABLED_FOR_ORDER_MANAGEMENT_SERVICE) {
        return;
      }

      Promise.resolve().then(async () => {
        try {
          const orders = await supabaseDb.orders_v2.findMany({
            where: {
              ...(customerId && { customer_id: customerId }),
              ...(stylistId && { stylist_id: stylistId }),
              ...(status && { status: status }),
            },
            include: {
              users_orders_v2_customer_idTousers: true,
              users_orders_v2_stylist_idTousers: true,
            },
            orderBy: {
              created_at: 'desc',
            },
          });

          const orderSummaries = await Promise.all(
            orders.map(order =>
              this.convertToOrderSummary(order).catch(error => {
                this.logService.error('Error converting order to summary', {
                  metadata: { orderId: order.id },
                  error,
                });
                return null;
              }),
            ),
          ).then(orderSummaries => orderSummaries.filter(Boolean) as OrderSummary[]);

          // Store in cache
          if (cacheKey) {
            await this.redisService.set(cacheKey, orderSummaries, CACHE_CONFIGS.USER);
          }

          this.logService.debug('Background orders cache refresh completed', {
            metadata: {
              customerId,
              stylistId,
              status,
              orderCount: orderSummaries.length,
            },
          });
        } catch (innerError) {
          this.logService.error('Error in background orders refresh process', {
            metadata: { customerId, stylistId, status },
            error: innerError,
          });
        }
      });
    } catch (error) {
      this.logService.error('Error initiating background orders cache refresh', {
        metadata: { customerId, stylistId, status },
        error,
      });
    }
  }

  async updateOrder(
    orderId: string,
    stylistId?: string,
    status?: OrderStatus,
    incrementUserViewVersion: boolean = false,
    isStarred?: boolean,
  ): Promise<OrderSummary> {
    try {
      this.logService.info('Updating order', {
        metadata: { orderId, stylistId, status, incrementUserViewVersion, isStarred },
      });
      const order = await supabaseDb.orders_v2.update({
        where: { id: orderId },
        data: {
          ...(stylistId && { stylist_id: stylistId }),
          ...(status && { status: convertOrderStatusToDbOrderStatus(status) }),
          ...(isStarred !== undefined && { is_starred: isStarred }),
          updated_at: new Date(),
          ...(incrementUserViewVersion && { user_view_version: { increment: 1 } }),
        },
        include: {
          users_orders_v2_customer_idTousers: true,
          users_orders_v2_stylist_idTousers: true,
        },
      });

      const orderSummary = await this.convertToOrderSummary(order);

      this.logService.info('Order updated', {
        metadata: { orderSummary },
      });

      // CACHING: Update/invalidate all related caches
      if (REDIS_ENABLED_FOR_ORDER_MANAGEMENT_SERVICE) {
        await Promise.all([
          // Update single-order cache
          this.redisService.set(`order:${order.id}`, orderSummary, CACHE_CONFIGS.USER),
          // Invalidate chat-id based cache
          this.redisService.del(`order:chatId:${order.chat_id}`, CACHE_CONFIGS.USER),
          // Invalidate enriched order cache
          this.redisService.del(`enriched_order:${order.id}`, CACHE_CONFIGS.USER),
          // Invalidate orders list caches - we use a pattern to match all possible combinations
          this.redisService.delByPattern(`orders:*`, CACHE_CONFIGS.USER),
          order.chat_id && this.exploreRequestService.clearCacheForRequest(order.chat_id),
        ]);
      }

      return orderSummary;
    } catch (error) {
      this.logService.error('Error updating order', {
        metadata: { orderId, stylistId, status },
        error,
      });
      throw error;
    }
  }

  async deleteOrder(orderId: string): Promise<boolean> {
    try {
      // First get the order to get the chat_id before deletion
      const order = await supabaseDb.orders_v2.findUnique({
        where: { id: orderId },
        include: {
          order_suggestion: true,
        },
      });

      if (!order) {
        throw new ServerError(Status.NOT_FOUND, `Order ${orderId} not found`);
      }

      // First delete all order suggestions
      if (order.order_suggestion && order.order_suggestion.length > 0) {
        this.logService.info('Deleting order suggestions before deleting order', {
          metadata: {
            orderId,
            suggestionCount: order.order_suggestion.length,
          },
        });

        await this.deleteOrderSuggestions({
          orderSuggestionIds: order.order_suggestion.map(suggestion => suggestion.id),
        });
      }

      // Then delete the order itself
      await supabaseDb.orders_v2.delete({
        where: { id: orderId },
      });

      // CACHING: Invalidate all related caches
      if (REDIS_ENABLED_FOR_ORDER_MANAGEMENT_SERVICE) {
        await Promise.all([
          this.redisService.del(`order:${orderId}`, CACHE_CONFIGS.USER),
          this.redisService.del(`order:chatId:${order.chat_id}`, CACHE_CONFIGS.USER),
          this.redisService.del(`enriched_order:${orderId}`, CACHE_CONFIGS.USER),
          this.redisService.delByPattern(`orders:*`, CACHE_CONFIGS.USER),
        ]);
      }

      return true;
    } catch (error) {
      this.logService.error('Error deleting order', {
        metadata: { orderId },
        error,
      });
      throw error;
    }
  }

  async getEnrichedOrder(orderId: string): Promise<EnrichedOrderDetail> {
    try {
      // Check cache first
      const cacheKey = `enriched_order:${orderId}`;
      const cached = REDIS_ENABLED_FOR_ORDER_MANAGEMENT_SERVICE
        ? await this.redisService.get<EnrichedOrderDetail>(cacheKey, CACHE_CONFIGS.USER)
        : undefined;

      if (cached) {
        // Refresh cache in background to keep it fresh
        this.getOrder(orderId)
          .then(async order => {
            const requestChat = order.chatId
              ? await this.exploreRequestService.getRequest(order.chatId)
              : undefined;

            const enrichedOrder = {
              order,
              requestChat: requestChat || undefined,
            };

            await this.redisService.set(cacheKey, enrichedOrder, {
              ...CACHE_CONFIGS.USER,
              ttl: 3600,
            });
          })
          .catch(error => {
            this.logService.error('Error refreshing enriched order cache', {
              metadata: { orderId },
              error,
            });
          });

        return cached;
      }

      // If not in cache, fetch all components
      const order = await this.getOrder(orderId);
      const requestChat = order.chatId
        ? await this.exploreRequestService.getRequest(order.chatId)
        : undefined;

      const enrichedOrder = {
        order,
        requestChat: requestChat || undefined,
      };

      // Store in cache with a shorter TTL since this combines multiple data sources
      if (REDIS_ENABLED_FOR_ORDER_MANAGEMENT_SERVICE) {
        const enrichedOrderCacheConfig = {
          ...CACHE_CONFIGS.USER,
          ttl: 3600, // 1 hour TTL for combined data
        };
        await this.redisService.set(cacheKey, enrichedOrder, enrichedOrderCacheConfig);
      }

      return enrichedOrder;
    } catch (error) {
      this.logService.error('Error getting enriched order', {
        metadata: { orderId },
        error,
      });
      throw error;
    }
  }

  async createOrderSuggestion(
    request: CreateOrderSuggestionRequest,
  ): Promise<{ orderSuggestionId: string }> {
    const user = getRequestUser();
    if (
      !user ||
      (user.role === UserRole.USER_ROLE_CUSTOMER &&
        (!user.email || !isAppStoreReviewerEmail(user.email)))
    ) {
      throw new Error('User not found');
    }

    const { orderId, productPurchases, isAutoAccepted } = request;
    const order = await this.getOrder(orderId);
    if (!order) {
      throw new Error('Order not found');
    }

    const isOrderFetchrInitiated = order.type === OrderType.ORDER_TYPE_FETCHR_INITIATED;
    const isDraftSuggestion = request.isDraft || user.role === UserRole.USER_ROLE_STYLIST;

    let hasValidPayment = true;
    try {
      const paymentStatus = await this.billingService.refreshCustomerPaymentStatus(
        order.customerId,
      );
      hasValidPayment = paymentStatus.status === PaymentMethodStatus.PAYMENT_METHOD_STATUS_VALID;
    } catch (error) {
      this.logService.error('Error checking payment status', {
        metadata: { orderId, customerId: order.customerId },
        error,
      });
      hasValidPayment = false;
    }
    this.logService.info('Order suggestion valid payment', {
      metadata: { hasValidPayment, order, customerId: order.customerId },
    });

    // Determine dates based on various conditions
    const dates = getOrderSuggestionDates({
      isAutoAccepted,
      isOrderFetchrInitiated,
      hasValidPayment,
      isDraftSuggestion,
    });

    const { id: orderSuggestionId } = await supabaseDb.order_suggestion.create({
      data: {
        order_id: orderId,
        status: this.getOrderSuggestionStatus({
          isAutoAccepted,
          isDraftSuggestion,
        }),
        verify_suggestions_by: dates.verifySuggestionsBy,
        expire_suggestions_by: dates.expireSuggestionsBy,
        stylist_note: request.stylistNote,
        ai_judge_analysis: null,
      },
    });

    await supabaseDb.product_purchase_suggestion.createManyAndReturn({
      data: productPurchases.map(
        (purchase): Omit<product_purchase_suggestion, 'id' | 'created_at'> => ({
          order_suggestion_id: orderSuggestionId,
          product_id: purchase.productId,
          size: purchase.size,
          price: purchase.price,
          original_price: purchase.originalPrice ?? purchase.price,
          is_refundable: purchase.isRefundable ?? true,
          is_accepted: isAutoAccepted,
          note: null,
          color: purchase.color,
          status: 'PENDING',
          ai_judge_analysis: null,
          is_archived: false,
          archive_reason: null,
          thread_ids: [],
        }),
      ),
    });

    if (REDIS_ENABLED_FOR_ORDER_MANAGEMENT_SERVICE) {
      await Promise.all([
        this.redisService.del(`order:${orderId}`, CACHE_CONFIGS.USER),
        this.redisService.del(`enriched_order:${orderId}`, CACHE_CONFIGS.USER),
        this.redisService.del(`order:${orderId}`),
        this.redisService.del(`enriched_order:${orderId}`),
        this.redisService.del(`orders:${order.customerId}:all:all`, CACHE_CONFIGS.USER),
      ]);
    }

    if (!isAutoAccepted && !isDraftSuggestion) {
      await this.sendOrderSuggestionNotification(orderSuggestionId, {
        orderId,
        userId: order.customerId,
        isOrderFetchrInitiated,
      });
    }

    const payload: JudgeOrderSuggestionPayload = {
      orderSuggestionId,
    };

    await tasks.trigger(taskIds.JUDGE_ORDER_SUGGESTION, payload);

    return { orderSuggestionId };
  }

  private getOrderSuggestionStatus({
    isAutoAccepted,
    isDraftSuggestion,
  }: {
    isAutoAccepted: boolean;
    isDraftSuggestion: boolean;
  }): order_suggestion_status {
    if (isAutoAccepted) {
      return order_suggestion_status.Reviewed;
    }
    if (isDraftSuggestion) {
      return order_suggestion_status.Draft;
    }
    return order_suggestion_status.Pending;
  }

  async sendOrderSuggestionNotification(
    orderSuggestionId: string,
    {
      orderId,
      userId,
      isOrderFetchrInitiated,
    }: { orderId: string; userId: string; isOrderFetchrInitiated: boolean },
  ): Promise<void> {
    const productPurchases = await supabaseDb.product_purchase_suggestion.findMany({
      where: { order_suggestion_id: orderSuggestionId },
    });

    if (isOrderFetchrInitiated) {
      this.notificationsService.sendNotification(NOTIFICATION_TYPE.ORDER_SUGGESTION, userId, {
        orderId,
        orderSuggestionId,
        title: 'Fetchr',
        body: `We handpicked some items for you. Check them out!`,
      });
    } else {
      this.notificationsService.sendNotification(NOTIFICATION_TYPE.ORDER_SUGGESTION, userId, {
        orderId,
        orderSuggestionId,
        title: 'Order Ready',
        body: `Review your ${
          productPurchases.length > 1 ? `${productPurchases.length} items` : 'item'
        } now. You have 24 hours to make changes before ${
          productPurchases.length > 1 ? 'they' : 'it'
        } ships.`,
      });
    }
  }

  async submitOrderSuggestionUserResponse(
    request: SubmitOrderSuggestionUserResponseRequest,
  ): Promise<void> {
    const { orderSuggestionId, acceptedProductPurchaseIds } = request;

    // Get the order suggestion to find the order ID
    const orderSuggestion = await supabaseDb.order_suggestion.findUnique({
      where: { id: orderSuggestionId },
      select: {
        order_id: true,
        orders_v2: {
          select: {
            customer_id: true,
          },
        },
      },
    });

    if (!orderSuggestion) {
      throw new Error('Order suggestion not found');
    }

    await supabaseDb.order_suggestion.update({
      where: { id: orderSuggestionId },
      data: {
        status: order_suggestion_status.Reviewed,
      },
    });

    await supabaseDb.product_purchase_suggestion.updateMany({
      where: { id: { in: acceptedProductPurchaseIds } },
      data: {
        is_accepted: true,
        status: 'APPROVED',
      },
    });

    await supabaseDb.product_purchase_suggestion.updateMany({
      where: {
        order_suggestion_id: orderSuggestionId,
        id: { notIn: acceptedProductPurchaseIds },
      },
      data: {
        is_accepted: false,
        status: 'REJECTED',
      },
    });

    // Invalidate caches
    if (REDIS_ENABLED_FOR_ORDER_MANAGEMENT_SERVICE) {
      await Promise.all([
        this.redisService.del(`order:${orderSuggestion.order_id}`, CACHE_CONFIGS.USER),
        this.redisService.del(`enriched_order:${orderSuggestion.order_id}`, CACHE_CONFIGS.USER),
      ]);
    }
  }

  // V2 Endpoints
  async addShipmentToOrderSuggestion(request: AddShipmentToOrderSuggestionRequest): Promise<{
    shipmentId: string;
  }> {
    const {
      orderSuggestionId,
      brandId,
      productPurchases,
      brandOrderNumber,
      expectedDeliveryDateStart,
      expectedDeliveryDateEnd,
      trackingNumber,
      trackingUrl,
      shipmentId,
      creditCardCardIdToLock,
      email,
      totalPrice,
      shippingCost,
    } = request;

    // Get the order suggestion to find the order ID
    const orderSuggestion = await supabaseDb.order_suggestion.findUnique({
      where: { id: orderSuggestionId },
      select: {
        order_id: true,
        orders_v2: {
          select: {
            customer_id: true,
          },
        },
      },
    });

    if (!orderSuggestion) {
      throw new Error('Order suggestion not found');
    }

    const brand = await supabaseDb.brands.findUnique({
      where: { id: brandId },
    });

    if (!brand) {
      throw new Error('Brand not found');
    }

    let finalShipmentId = shipmentId;
    let paymentId: string | null = null;

    try {
      const centsToCharge = Math.round((totalPrice - (shippingCost || 0)) * 100);
      this.logService.info('Payment Amount to charge', {
        metadata: { amountToCharge: centsToCharge, totalPrice, shippingCost },
      });
      if (centsToCharge <= 0) {
        throw new Error('Total price is less than shipping cost');
      }
      const userProfile = await this.profileService.getProfile(
        orderSuggestion.orders_v2.customer_id,
      );
      if (!userProfile) {
        throw new Error('User profile not found');
      }

      if (!userProfile.email || !isAppStoreReviewerEmail(userProfile.email)) {
        // Charge the customer (if not an app store reviewer)
        if (!userProfile.billing?.stripeCustomerId) {
          throw new Error('No payment method found for user');
        }

        paymentId = await this.billingService.chargeCustomer(
          userProfile.billing.stripeCustomerId,
          centsToCharge,
          userProfile.email,
          {
            order_suggestion_id: orderSuggestionId,
            brand_id: brandId,
          },
        );
      }
    } catch (error) {
      this.logService.error('Error in payment, charging customer', {
        metadata: { error },
      });
      throw error;
    }

    try {
      const { id: dbShipmentId } = await supabaseDb.shipment.create({
        data: {
          ...(shipmentId ? { id: shipmentId } : {}),
          order_suggestion_id: orderSuggestionId,
          brand_id: brandId,
          brand_order_number: brandOrderNumber,
          tracking_number: trackingNumber,
          tracking_url: trackingUrl,
          expected_delivery_date_start: expectedDeliveryDateStart
            ? new Date(expectedDeliveryDateStart)
            : null,
          expected_delivery_date_end: expectedDeliveryDateEnd
            ? new Date(expectedDeliveryDateEnd)
            : null,
          unique_email_address: email,
          total_price: totalPrice,
          shipping_cost: shippingCost,
          stripe_payment_id: paymentId,
        },
      });

      await supabaseDb.product_purchase.createMany({
        data: productPurchases.map(
          (purchase): Omit<product_purchase, 'id' | 'created_at' | 'refund_status'> => ({
            shipment_id: dbShipmentId,
            product_id: purchase.productId,
            size: purchase.size,
            price: purchase.price,
            original_price: purchase.originalPrice ?? purchase.price,
            is_refundable: purchase.isRefundable ?? true,
            purchased_at: new Date(),
            user_feedback_categories: [],
            user_feedback_note: null,
            color: purchase.color,
            payment_status: 'paid',
            stripe_payment_id: null,
            is_archived: false,
            archive_reason: null,
          }),
        ),
      });

      finalShipmentId = dbShipmentId;
    } catch (error) {
      this.logService.error('Error creating shipment', {
        metadata: {
          orderSuggestionId,
          brandId,
          productPurchases,
          brandOrderNumber,
          expectedDeliveryDateStart,
          expectedDeliveryDateEnd,
          trackingNumber,
          trackingUrl,
          shipmentId,
          creditCardCardIdToLock,
          totalPrice,
          shippingCost,
        },
        error,
      });
    }

    // Invalidate caches
    if (REDIS_ENABLED_FOR_ORDER_MANAGEMENT_SERVICE) {
      await Promise.all([
        this.redisService.del(`order:${orderSuggestion.order_id}`, CACHE_CONFIGS.USER),
        this.redisService.del(`enriched_order:${orderSuggestion.order_id}`, CACHE_CONFIGS.USER),
      ]);
    }

    try {
      if (creditCardCardIdToLock) {
        await this.brexService.lockCard(creditCardCardIdToLock);
        await supabaseDb.cards_to_terminate.update({
          where: { card_id: creditCardCardIdToLock },
          data: {
            lock_at: undefined,
          },
        });
      }
    } catch (error) {
      this.logService.error('Error locking card', {
        metadata: { creditCardCardIdToLock },
        error,
      });
    }

    if (!finalShipmentId) {
      throw new Error('Shipment ID not found');
    }

    return { shipmentId: finalShipmentId };
  }

  async getShipmentBatch(shipmentIds: string[]): Promise<Shipment[]> {
    const shipments = await supabaseDb.shipment.findMany({
      where: { id: { in: shipmentIds } },
      include: {
        brands: true,
        product_purchase: {
          include: {
            products_clean: true,
          },
        },
      },
    });

    return convertDbShipmentToShipmentBatch(shipments);
  }

  async getShipmentUsingEmail(email: string): Promise<Shipment | undefined> {
    const shipment = await supabaseDb.shipment.findUnique({
      where: { unique_email_address: email },
      include: {
        brands: true,
        product_purchase: {
          include: {
            products_clean: true,
          },
        },
        order_suggestion: true,
      },
    });

    if (!shipment) {
      return undefined;
    }

    return convertDbShipmentToShipment(shipment);
  }

  async getShipment(shipmentId: string): Promise<Shipment | undefined> {
    try {
      const shipment = await supabaseDb.shipment.findUnique({
        where: { id: shipmentId },
        include: {
          order_suggestion: true,
          brands: true,
          product_purchase: {
            include: {
              products_clean: true,
            },
          },
        },
      });

      if (!shipment) {
        return undefined;
      }

      return convertDbShipmentToShipment(shipment);
    } catch (error) {
      console.error('Error getting shipment:', error);
      return undefined;
    }
  }

  async updateShipmentUrlAndTrackingNumbers(
    emailAddress: string,
    {
      trackingUrl,
      possibleTrackingNumbers,
    }: {
      trackingUrl?: string;
      possibleTrackingNumbers?: string[];
    },
  ): Promise<void> {
    await supabaseDb.shipment.update({
      where: { unique_email_address: emailAddress },
      data: {
        ...(trackingUrl ? { tracking_url: trackingUrl } : {}),
        ...(possibleTrackingNumbers ? { possible_tracking_numbers: possibleTrackingNumbers } : {}),
      },
    });
  }

  async updateShippingInformation(request: UpdateShippingInformationRequest): Promise<void> {
    const {
      shipmentId,
      brandOrderNumber,
      trackingNumber,
      trackingUrl,
      expectedDeliveryDateStart,
      expectedDeliveryDateEnd,
      status,
      email,
    } = request;

    // Get the shipment to find the order ID
    const shipment = await supabaseDb.shipment.findUnique({
      where: { id: shipmentId },
      include: {
        order_suggestion: {
          select: {
            order_id: true,
          },
        },
      },
    });

    if (!shipment) {
      throw new Error('Shipment not found');
    }

    const updateData: Prisma.shipmentUpdateInput = {};

    if (brandOrderNumber) {
      updateData.brand_order_number = brandOrderNumber;
    }

    if (trackingNumber) {
      updateData.tracking_number = trackingNumber;
    }

    if (trackingUrl) {
      updateData.tracking_url = trackingUrl;
    }

    if (expectedDeliveryDateStart) {
      updateData.expected_delivery_date_start = new Date(expectedDeliveryDateStart);
    }

    if (expectedDeliveryDateEnd) {
      updateData.expected_delivery_date_end = new Date(expectedDeliveryDateEnd);
    }

    if (email) {
      updateData.unique_email_address = email;
    }

    if (status) {
      updateData.status = convertShipmentStatusToDbShipmentStatus(status);

      const currentShipment = await supabaseDb.shipment.findUnique({
        where: { id: shipmentId },
        include: {
          order_suggestion: {
            include: {
              orders_v2: true,
            },
          },
          product_purchase: true,
        },
      });

      if (!currentShipment) {
        throw new Error('Shipment not found');
      }

      const currentStatus = convertDbShipmentStatusToShipmentStatus(currentShipment.status);
      if (status === ShipmentStatus.SHIPMENT_STATUS_DELIVERED) {
        if (currentStatus !== ShipmentStatus.SHIPMENT_STATUS_DELIVERED) {
          const deliveredAt = new Date();
          await supabaseDb.shipment.update({
            where: { id: shipmentId },
            data: { delivered_at: deliveredAt },
          });
          // Check if this is the final shipment for the order
          const remainingShipments = await supabaseDb.shipment.count({
            where: {
              order_suggestion_id: currentShipment.order_suggestion_id,
              status: {
                notIn: [
                  convertShipmentStatusToDbShipmentStatus(ShipmentStatus.SHIPMENT_STATUS_DELIVERED),
                ],
              },
              id: {
                not: shipmentId,
              },
            },
          });

          this.logService.info('Remaining shipments', {
            metadata: {
              remainingShipments,
              currentShipment,
            },
          });

          if (remainingShipments === 0) {
            await supabaseDb.order_suggestion.update({
              where: { id: currentShipment.order_suggestion_id },
              data: {
                verify_purchase_by: new Date(
                  new Date(deliveredAt.getTime() + 3 * 24 * 60 * 60 * 1000).setHours(
                    23,
                    59,
                    59,
                    999,
                  ),
                ), // 3 days after this (last) delivery, end of day
              },
            });
          }

          const totalShipments = await supabaseDb.shipment.count({
            where: {
              order_suggestion_id: currentShipment.order_suggestion_id,
            },
          });

          await this.notificationsService.sendNotification(
            NOTIFICATION_TYPE.ORDER_SUGGESTION,
            currentShipment.order_suggestion.orders_v2.customer_id,
            {
              orderId: currentShipment.order_suggestion.orders_v2.id,
              orderSuggestionId: currentShipment.order_suggestion.id,
              title: 'Package delivered',
              body:
                totalShipments === 1
                  ? "Your package was delivered! Try everything on and let us know what you'd like to keep or return within 3 days."
                  : remainingShipments > 0
                  ? 'One of your shipments just arrived. Enjoy unboxing—more to come soon!'
                  : "Your final shipment was delivered! Try everything on and let us know what you'd like to keep or return within 3 days.",
            },
          );
        }
      }
    }

    await supabaseDb.shipment.update({
      where: { id: shipmentId },
      data: updateData,
    });

    // Invalidate caches
    if (REDIS_ENABLED_FOR_ORDER_MANAGEMENT_SERVICE) {
      await Promise.all([
        this.redisService.del(`order:${shipment.order_suggestion.order_id}`, CACHE_CONFIGS.USER),
        this.redisService.del(
          `enriched_order:${shipment.order_suggestion.order_id}`,
          CACHE_CONFIGS.USER,
        ),
      ]);
    }
  }

  async getOrderSuggestionsForOrder(orderId: string): Promise<PopulatedOrderSuggestion[]> {
    void orderId;
    // const orderSuggestions = await supabaseDb.order_suggestion.findMany({
    //   where: { order_id: orderId },
    // });

    // return orderSuggestions;
    throw new Error('Not implemented');
  }

  async deleteShipment(shipmentId: string): Promise<void> {
    const shipment = await supabaseDb.shipment.findUnique({
      where: { id: shipmentId },
      include: {
        order_suggestion: {
          select: { order_id: true },
        },
      },
    });

    // First delete all associated product purchases
    await supabaseDb.product_purchase.deleteMany({
      where: { shipment_id: shipmentId },
    });

    // Then delete the shipment
    await supabaseDb.shipment.delete({
      where: { id: shipmentId },
    });

    // Invalidate caches
    if (REDIS_ENABLED_FOR_ORDER_MANAGEMENT_SERVICE) {
      if (shipment) {
        await Promise.all([
          this.redisService.del(`order:${shipment.order_suggestion.order_id}`, CACHE_CONFIGS.USER),
          this.redisService.del(
            `enriched_order:${shipment.order_suggestion.order_id}`,
            CACHE_CONFIGS.USER,
          ),
        ]);
      }
    }
  }

  async submitProductPurchaseFeedback(
    request: SubmitProductPurchaseFeedbackRequest,
  ): Promise<void> {
    const { productPurchaseId, categories, feedback, isRefundRequested } = request;

    // Get the current request user
    const currentUser = getRequestUser();
    if (!currentUser) {
      throw new Error('User not authenticated');
    }

    const productPurchase = await supabaseDb.product_purchase.findUnique({
      where: { id: productPurchaseId },
      include: {
        shipment: {
          include: {
            order_suggestion: {
              include: {
                orders_v2: true,
              },
            },
          },
        },
        products_clean: true,
      },
    });

    this.logService.info('Product purchase:', {
      metadata: { productPurchaseId, productPurchase },
    });

    // Check if product purchase exists and if current user is the owner of the order
    if (
      !productPurchase ||
      productPurchase?.shipment?.order_suggestion?.orders_v2.customer_id !== currentUser.id
    ) {
      this.logService.info(
        `User ${currentUser.id} is not authorized to provide feedback for product purchase ${productPurchaseId}`,
      );
      throw new Error('Product purchase not found or you are not authorized to provide feedback');
    }

    if (isRefundRequested) {
      await supabaseDb.product_purchase.update({
        where: { id: productPurchaseId },
        data: {
          user_feedback_categories: categories.map(
            convertProductPurchaseFeedbackCategoryToDbProductPurchaseFeedbackCategory,
          ),
          user_feedback_note: feedback,
          refund_status: 'requested',
        },
      });
    } else {
      await supabaseDb.product_purchase.update({
        where: { id: productPurchaseId },
        data: {
          user_feedback_categories: categories.map(
            convertProductPurchaseFeedbackCategoryToDbProductPurchaseFeedbackCategory,
          ),
          user_feedback_note: feedback,
          refund_status: 'item_kept',
        },
      });
    }

    const product = productPurchase.products_clean;
    // Send Slack notification to refunds channel
    if (process.env.SLACK_REFUNDS_CHANNEL_ID && isRefundRequested) {
      const userInfo: UserInfo = {
        id: currentUser.id,
        name: currentUser.name,
        email: currentUser.email,
        phoneNumber: currentUser.phoneNumber,
      };

      const additionalBlocks = [
        {
          type: 'section' as const,
          text: {
            type: 'mrkdwn' as const,
            text: `*Refund Details:*\n• Product: ${product?.title || 'Unknown'}\n• Order ID: ${
              productPurchase.shipment.order_suggestion.orders_v2.id
            }\n• Order URL: https://admin.fetchr.so/orders/${
              productPurchase.shipment.order_suggestion.orders_v2.id
            }\n• Feedback Categories: ${categories
              .map(convertProductPurchaseFeedbackCategoryToDbProductPurchaseFeedbackCategory)
              .join(', ')}\n• Feedback Note: ${feedback || 'None'}`,
          },
        },
      ];

      await this.slackService.sendMessageWithUserInfo(
        process.env.SLACK_REFUNDS_CHANNEL_ID,
        '💸 *New Refund Request*',
        userInfo,
        {
          userLabel: 'Customer',
          additionalBlocks,
        },
      );
    }
    if (REDIS_ENABLED_FOR_ORDER_MANAGEMENT_SERVICE) {
      await this.redisService.del(
        `enriched_order:${productPurchase.shipment.order_suggestion.orders_v2.id}`,
        CACHE_CONFIGS.USER,
      );
      await this.redisService.del(
        `order:${productPurchase.shipment.order_suggestion.orders_v2.id}`,
        CACHE_CONFIGS.USER,
      );
      await this.redisService.del(
        `orders:${productPurchase.shipment.order_suggestion.orders_v2.customer_id}:all:all`,
        CACHE_CONFIGS.USER,
      );
    }
  }

  async submitProductPurchaseSuggestionFeedback(
    request: SubmitProductPurchaseSuggestionFeedbackRequest,
  ): Promise<SubmitProductPurchaseSuggestionFeedbackResponse> {
    // This technically is only used when a customer rejects a product purchase suggestion
    const currentUser = getRequestUser();
    if (!currentUser) {
      throw new ServerError(Status.UNAUTHENTICATED, 'User not authenticated');
    }

    const { productPurchaseId, note } = request;

    // First verify the suggestion exists and belongs to the user
    const suggestion = await supabaseDb.product_purchase_suggestion.findFirst({
      where: {
        id: productPurchaseId,
        order_suggestion: {
          orders_v2: {
            customer_id: currentUser.id,
          },
        },
      },
      include: {
        order_suggestion: {
          include: {
            product_purchase_suggestion: {
              include: {
                product_purchase_suggestion_thread: {
                  include: {
                    threads: true,
                  },
                },
              },
            },
            orders_v2: true,
          },
        },
      },
    });

    if (!suggestion) {
      throw new ServerError(
        Status.NOT_FOUND,
        'Product purchase suggestion not found or you are not authorized to update it',
      );
    }

    // Now perform the update

    const productPurchaseSuggestion = await supabaseDb.product_purchase_suggestion.update({
      where: {
        id: productPurchaseId,
      },
      data: {
        note,
        is_accepted: false,
        status: 'REJECTED',
      },
      include: {
        products_clean: true,
        product_purchase_suggestion_thread: {
          include: {
            threads: {
              include: {
                thread_messages: true,
              },
            },
          },
        },
      },
    });

    const orderId = suggestion.order_suggestion.orders_v2.id;

    // Invalidate the enriched order cache
    if (REDIS_ENABLED_FOR_ORDER_MANAGEMENT_SERVICE) {
      await this.redisService.del(`enriched_order:${orderId}`, CACHE_CONFIGS.USER);
      await this.redisService.del(`order:${orderId}`, CACHE_CONFIGS.USER);
      await this.redisService.del(
        `orders:${suggestion.order_suggestion.orders_v2.customer_id}:all:all`,
        CACHE_CONFIGS.USER,
      );
    }

    if (process.env.SLACK_ORDERS_CHANNEL_ID) {
      this.profileService
        .getProfile(suggestion.order_suggestion.orders_v2.customer_id)
        .then(async customer => {
          if (customer && process.env.SLACK_ORDERS_CHANNEL_ID) {
            this.slackService
              .sendMessage(
                process.env.SLACK_ORDERS_CHANNEL_ID,
                `Product purchase suggestion rejected!`,
                {
                  blocks: [
                    {
                      type: 'section',
                      text: {
                        type: 'mrkdwn',
                        text: [
                          '*Product Purchase Suggestion Rejected*',
                          `• Order ID: ${orderId}`,
                          `• Customer: ${customer.email}`,
                          `• Product: ${
                            productPurchaseSuggestion.products_clean?.title || 'Unknown'
                          }`,
                          `• Note: ${note}`,
                        ].join('\n'),
                      },
                    },
                  ],
                },
              )
              .catch(error => {
                this.logService.error('Error sending Slack notification', {
                  metadata: { orderId },
                  error,
                });
              });
          }
        });
    }

    // Check if all product purchase suggestions for this order suggestion have received feedback
    const allSuggestions = await supabaseDb.product_purchase_suggestion.findMany({
      where: { order_suggestion_id: suggestion.order_suggestion_id },
    });

    const allSuggestionsHaveFeedback = allSuggestions.every(
      suggestion => suggestion.status === 'REJECTED',
    );

    // If all suggestions have received feedback, finalize the order suggestion
    if (allSuggestionsHaveFeedback) {
      this.logService.info(
        'All product purchase suggestions have received feedback, finalizing order suggestion',
        {
          metadata: {
            orderSuggestionId: suggestion.order_suggestion_id,
            orderId,
          },
        },
      );

      await this.finalizeOrderSuggestion(
        { orderSuggestionId: suggestion.order_suggestion_id },
        suggestion.order_suggestion.orders_v2.customer_id,
        false, // Finalized by the user manually finalizing each item in the order
      );
    }

    if (currentUser.email && isAppStoreReviewerEmail(currentUser.email)) {
      // Archive the suggestion for app store reviewers
      try {
        await supabaseDb.product_purchase_suggestion.update({
          where: { id: productPurchaseId },
          data: {
            is_archived: true,
            archive_reason: 'App Store Reviewer Test',
          },
        });

        this.logService.info('Archived product purchase suggestion for app store reviewer', {
          metadata: { productPurchaseId, userEmail: currentUser.email },
        });
      } catch (error) {
        this.logService.error(
          'Error archiving product purchase suggestion for app store reviewer',
          {
            metadata: { productPurchaseId },
            error,
          },
        );
      }
      this.sendSampleOrderSuggestion(orderId);
    }

    return {
      productPurchaseSuggestion:
        await convertDbProductPurchaseSuggestionToProductPurchaseSuggestion(
          productPurchaseSuggestion,
        ),
    };
  }

  async finalizeOrderSuggestion(
    request: FinalizeOrderSuggestionRequest,
    userId: string,
    isAutoFinalization: boolean = false,
  ): Promise<FinalizeOrderSuggestionResponse> {
    const currentUser = await this.profileService.getProfile(userId);
    if (!isAutoFinalization && !currentUser) {
      throw new ServerError(Status.UNAUTHENTICATED, 'User not authenticated');
    }

    const { orderSuggestionId } = request;

    const orderSuggestion = await supabaseDb.order_suggestion.findUnique({
      where: { id: orderSuggestionId },
      include: {
        orders_v2: true,
      },
    });

    if (!orderSuggestion) {
      throw new ServerError(Status.NOT_FOUND, 'Order suggestion not found');
    }

    this.logService.info('Order suggestion:', {
      metadata: { orderSuggestionId, orderSuggestion, userId },
    });

    if (!isAutoFinalization && orderSuggestion?.orders_v2.customer_id !== userId) {
      this.logService.info(
        `User ${userId} is not authorized to finalize order suggestion ${orderSuggestionId} owned by ${orderSuggestion?.orders_v2.customer_id}`,
      );
      throw new ServerError(
        Status.PERMISSION_DENIED,
        'You are not authorized to finalize this order suggestion',
      );
    }

    // First update the original order suggestion status
    const updatedOrderSuggestion = await supabaseDb.order_suggestion.update({
      where: { id: orderSuggestionId },
      data: { status: order_suggestion_status.Reviewed },
      include: {
        product_purchase_suggestion: {
          include: {
            products_clean: true,
            product_purchase_suggestion_thread: {
              include: {
                threads: {
                  include: {
                    thread_messages: true,
                  },
                },
              },
            },
          },
        },
        shipment: {
          include: {
            product_purchase: {
              include: {
                products_clean: true,
              },
            },
          },
        },
      },
    });

    // Get all product purchase suggestions for this order suggestion
    const productPurchaseSuggestions = await supabaseDb.product_purchase_suggestion.findMany({
      where: { order_suggestion_id: orderSuggestionId, is_archived: false },
    });

    // Separate accepted and rejected suggestions
    const acceptedOrPendingSuggestions = productPurchaseSuggestions.filter(
      suggestion => suggestion.status === 'APPROVED' || suggestion.status === 'PENDING',
    );

    const rejectedSuggestions = productPurchaseSuggestions.filter(
      suggestion => suggestion.status === 'REJECTED',
    );

    if (rejectedSuggestions.length !== productPurchaseSuggestions.length) {
      // Split the rejected suggestions into new order suggestions

      // If there are rejected suggestions, create a new order suggestion for them
      if (rejectedSuggestions.length > 0) {
        const newOrderSuggestion = await supabaseDb.order_suggestion.create({
          data: {
            order_id: orderSuggestion.orders_v2.id,
            status: order_suggestion_status.Reviewed,
          },
        });

        // Move rejected suggestions to new order suggestion
        await Promise.all(
          rejectedSuggestions.map(suggestion =>
            supabaseDb.product_purchase_suggestion.update({
              where: { id: suggestion.id },
              data: {
                order_suggestion_id: newOrderSuggestion.id,
                status: 'REJECTED',
                is_accepted: false,
              },
            }),
          ),
        );
      }

      // Update accepted suggestions in the original order suggestion
      await supabaseDb.product_purchase_suggestion.updateMany({
        where: {
          id: { in: acceptedOrPendingSuggestions.map(s => s.id) },
          status: { notIn: ['REJECTED'] },
        },
        data: {
          is_accepted: true,
          status: 'APPROVED',
        },
      });
    }

    // Send Slack notification to orders channel
    if (process.env.SLACK_ORDERS_CHANNEL_ID) {
      const userInfo: UserInfo = currentUser
        ? {
            id: currentUser.id,
            name: currentUser.name,
            email: currentUser.email ?? undefined,
            phoneNumber: currentUser.phoneNumber ?? undefined,
          }
        : {
            email: 'Auto-finalized',
          };

      const additionalBlocks = [
        {
          type: 'section' as const,
          text: {
            type: 'mrkdwn' as const,
            text: `*Review Details:*\n• Order ID: ${orderSuggestion.orders_v2.id}\n• Review Type: ${
              isAutoFinalization ? '🤖 Automatic' : '👤 Manual'
            }\n• Items Accepted: ${acceptedOrPendingSuggestions.length}\n• Items Rejected: ${
              rejectedSuggestions.length
            }`,
          },
        },
      ];

      this.slackService
        .sendMessageWithUserInfo(
          process.env.SLACK_ORDERS_CHANNEL_ID,
          '📋 *Order Suggestion Reviewed*',
          userInfo,
          {
            userLabel: isAutoFinalization ? 'System' : 'Customer',
            additionalBlocks,
          },
        )
        .catch(error => {
          this.logService.error('Error sending Slack notification', {
            metadata: { orderId: orderSuggestion.orders_v2.id },
            error,
          });
        });
    }

    this.logService.info('Deleting order and enriched order from cache', {
      metadata: { orderId: orderSuggestion.orders_v2.id },
    });
    if (REDIS_ENABLED_FOR_ORDER_MANAGEMENT_SERVICE) {
      this.redisService.del(`order:${orderSuggestion.orders_v2.id}`, CACHE_CONFIGS.USER);
      this.redisService.del(`enriched_order:${orderSuggestion.orders_v2.id}`, CACHE_CONFIGS.USER);
      this.redisService.del(`order:${orderSuggestion.orders_v2.id}`);
      this.redisService.del(`enriched_order:${orderSuggestion.orders_v2.id}`);
      this.redisService.del(
        `orders:${orderSuggestion.orders_v2.customer_id}:all:all`,
        CACHE_CONFIGS.USER,
      );
    }

    const convertedOrderSuggestion = await convertDbOrderSuggestionsToOrderSuggestion(
      updatedOrderSuggestion,
    );

    if (isAppStoreReviewerEmail(currentUser?.email ?? '')) {
      await this.sendSampleShipmentForOrderSuggestion(
        convertedOrderSuggestion,
        orderSuggestion.orders_v2.id,
      );
    }

    return {
      orderSuggestion: convertedOrderSuggestion,
    };
  }

  async sendSampleShipmentForOrderSuggestion(
    orderSuggestion: PopulatedOrderSuggestion,
    orderId: string,
  ): Promise<void> {
    try {
      this.logService.debug(`Sending sample shipment for order: ${orderId}`);

      if (!orderSuggestion || !orderSuggestion.productSuggestions?.length) {
        this.logService.error('No product purchase suggestions found for order', {
          metadata: { orderId },
        });
        return;
      }

      const approvedProductSuggestions = orderSuggestion.productSuggestions.filter(
        suggestion =>
          suggestion.status ===
            ProductPurchaseSuggestionStatus.PRODUCT_PURCHASE_SUGGESTION_STATUS_ACCEPTED ||
          suggestion.status ===
            ProductPurchaseSuggestionStatus.PRODUCT_PURCHASE_SUGGESTION_STATUS_PENDING,
      );

      if (approvedProductSuggestions.length === 0) {
        this.setSuggestionArchived(orderSuggestion.id, true);
        this.logService.error('No approved product purchase suggestions found for order', {
          metadata: { orderId },
        });
        return;
      }

      // Use the first product purchase suggestion as our sample
      const productSuggestion = approvedProductSuggestions[0];

      if (!productSuggestion.product) {
        throw new ServerError(Status.NOT_FOUND, 'No product found for product suggestion');
      }

      await this.addShipmentToOrderSuggestion({
        orderSuggestionId: orderSuggestion.id,
        brandId: productSuggestion.product.brandId,
        productPurchases: [
          {
            color: productSuggestion.color,
            size: productSuggestion.size,
            productId: productSuggestion.product.id,
            price: productSuggestion.product.price,
          },
        ],
        trackingNumber: 'SAMPLE123456789',
        totalPrice: (productSuggestion.product.price ?? 0) * 1.1,
        expectedDeliveryDateStart: Date.now() + 3 * 24 * 60 * 60 * 1000,
        expectedDeliveryDateEnd: Date.now() + 5 * 24 * 60 * 60 * 1000,
      });
    } catch (error) {
      this.logService.error('Error creating sample shipment for app store reviewer', {
        metadata: { orderId },
        error,
      });
    }
  }

  async attachAiJudgeAnalysisToProductPurchaseSuggestion(
    productPurchaseSuggestionId: string,
    aiJudgeAnalysis: string,
  ): Promise<void> {
    await supabaseDb.product_purchase_suggestion.update({
      where: { id: productPurchaseSuggestionId },
      data: {
        ai_judge_analysis: aiJudgeAnalysis,
      },
    });
  }

  async getOrderSuggestionAndOrder(orderSuggestionId: string): Promise<{
    orderSuggestion: PopulatedOrderSuggestion;
    order: OrderSummary;
  }> {
    const dbOrderSuggestion = await supabaseDb.order_suggestion.findUnique({
      where: { id: orderSuggestionId },
      include: {
        orders_v2: true,
        product_purchase_suggestion: {
          include: {
            products_clean: true,
            product_purchase_suggestion_thread: {
              include: {
                threads: {
                  include: {
                    thread_messages: true,
                  },
                },
              },
            },
          },
        },
        shipment: {
          include: {
            product_purchase: {
              include: {
                products_clean: true,
              },
            },
          },
        },
      },
    });

    if (!dbOrderSuggestion) {
      throw new ServerError(Status.NOT_FOUND, 'Order suggestion not found');
    }

    const order = await this.getOrder(dbOrderSuggestion.orders_v2.id);
    return {
      orderSuggestion: await convertDbOrderSuggestionsToOrderSuggestion(dbOrderSuggestion),
      order,
    };
  }

  async getOrderSuggestion(orderSuggestionId: string): Promise<PopulatedOrderSuggestion> {
    const orderSuggestion = await supabaseDb.order_suggestion.findUnique({
      where: { id: orderSuggestionId },
      include: {
        product_purchase_suggestion: {
          include: {
            products_clean: true,
            product_purchase_suggestion_thread: {
              include: {
                threads: {
                  include: {
                    thread_messages: true,
                  },
                },
              },
            },
          },
        },
        shipment: {
          include: {
            product_purchase: {
              include: {
                products_clean: true,
              },
            },
          },
        },
      },
    });
    if (!orderSuggestion) {
      throw new ServerError(Status.NOT_FOUND, 'Order suggestion not found');
    }

    return await convertDbOrderSuggestionsToOrderSuggestion(orderSuggestion);
  }

  async replaceOrderSuggestion(
    request: ReplaceOrderSuggestionRequest,
  ): Promise<ReplaceOrderSuggestionResponse> {
    const { orderSuggestionId, productPurchases } = request;

    const orderSuggestion = await supabaseDb.order_suggestion.findUnique({
      where: { id: orderSuggestionId },
    });

    if (!orderSuggestion) {
      throw new ServerError(Status.NOT_FOUND, 'Order suggestion not found');
    }

    const { orderSuggestionId: newOrderSuggestionId } = await this.createOrderSuggestion({
      orderId: orderSuggestion.order_id,
      productPurchases,
      isAutoAccepted: true,
      isDraft: orderSuggestion.status === 'Draft',
    });

    await supabaseDb.order_suggestion.update({
      where: { id: orderSuggestionId },
      data: {
        status: 'Archived',
      },
    });

    return {
      orderSuggestion: await this.getOrderSuggestion(newOrderSuggestionId),
    };
  }

  async setSuggestionArchived(orderSuggestionId: string, shouldArchive: boolean): Promise<void> {
    const orderSuggestion = await supabaseDb.order_suggestion.findUnique({
      where: { id: orderSuggestionId },
      include: {
        orders_v2: true,
      },
    });

    if (!orderSuggestion) {
      throw new ServerError(Status.NOT_FOUND, 'Order suggestion not found');
    }

    const currentStatus = orderSuggestion.status;
    // If already in desired state, return early
    if (
      (currentStatus === 'Archived' && shouldArchive) ||
      (currentStatus !== 'Archived' && !shouldArchive)
    ) {
      return;
    }

    await supabaseDb.order_suggestion.update({
      where: { id: orderSuggestionId },
      data: {
        status: shouldArchive ? 'Archived' : orderSuggestion.pre_archive_status ?? 'Reviewed',
        pre_archive_status: shouldArchive ? currentStatus : null,
      },
    });

    if (REDIS_ENABLED_FOR_ORDER_MANAGEMENT_SERVICE) {
      this.redisService.del(`order:${orderSuggestion.order_id}`, CACHE_CONFIGS.USER);
      this.redisService.del(`enriched_order:${orderSuggestion.order_id}`, CACHE_CONFIGS.USER);
      this.redisService.del(`order:${orderSuggestion.order_id}`);
      this.redisService.del(`enriched_order:${orderSuggestion.order_id}`);
      this.redisService.del(
        `orders:${orderSuggestion.orders_v2.customer_id}:all:all`,
        CACHE_CONFIGS.USER,
      );
    }
  }

  async lockAndTerminateOldCards(): Promise<void> {
    const cardsToTerminate = await supabaseDb.cards_to_terminate.findMany({
      where: {
        terminate_at: { lt: new Date() },
      },
    });

    await Promise.all(
      cardsToTerminate.map(async card => {
        try {
          await this.brexService.terminateCard(card.card_id, 'DO_NOT_NEED_VIRTUAL_CARD');

          await supabaseDb.cards_to_terminate.delete({
            where: { id: card.id },
          });
        } catch (error) {
          this.logService.error('Error terminating card', {
            metadata: { cardId: card.card_id },
            error,
          });
        }
      }),
    );

    const cardsToLock = await supabaseDb.cards_to_terminate.findMany({
      where: {
        lock_at: { lt: new Date() },
      },
    });

    await Promise.all(
      cardsToLock.map(async card => {
        try {
          await this.brexService.lockCard(card.card_id);

          await supabaseDb.cards_to_terminate.update({
            where: { id: card.id },
            data: { lock_at: null },
          });
        } catch (error) {
          this.logService.error('Error locking card', {
            metadata: { cardId: card.card_id },
            error,
          });
        }
      }),
    );
  }

  async chargeVerifiedPurchases(limitToUserIds?: string[]): Promise<void> {
    this.logService.info('Charging verified purchases', {
      metadata: {
        limitToUserIds: limitToUserIds?.length,
      },
    });

    // Find order suggestions that have passed their verify purchase deadline
    const expiredPurchases = await supabaseDb.product_purchase.findMany({
      where: {
        refund_status: {
          in: ['deadline_expired', 'item_kept'],
        },
        payment_status: 'not_paid',
      },
      include: {
        shipment: {
          include: {
            product_purchase: {
              where: {
                refund_status: {
                  in: ['pending_user_feedback', 'deadline_expired', 'item_kept'],
                },
              },
              include: {
                products_clean: {
                  select: {
                    title: true,
                    brands: {
                      select: {
                        company: true,
                      },
                    },
                  },
                },
              },
            },
            brands: true,
            order_suggestion: {
              include: {
                orders_v2: true,
              },
            },
          },
        },
      },
    });

    this.logService.info('Found expired purchases', {
      metadata: {
        expiredPurchases: expiredPurchases.length,
      },
    });

    for (const purchase of expiredPurchases) {
      try {
        if (purchase.shipment.product_purchase.length === 0) {
          continue;
        }
        const orderSuggestion = purchase.shipment.order_suggestion;

        // Get the user's profile to get their Stripe customer ID and address
        const userProfile = await this.profileService.getProfile(
          orderSuggestion.orders_v2.customer_id,
        );

        if (!userProfile) {
          this.logService.error('No user profile found for user', {
            metadata: {
              userId: orderSuggestion.orders_v2.customer_id,
            },
          });
          continue;
        }

        if (limitToUserIds && !limitToUserIds.includes(userProfile.id)) {
          continue;
        }

        if (!userProfile.billing?.stripeCustomerId) {
          this.logService.error('No Stripe customer ID found for user', {
            metadata: {
              userId: orderSuggestion.orders_v2.customer_id,
              purchaseId: purchase.id,
            },
          });
          continue;
        }

        const product = await this.productService.getProductOrFail(purchase.product_id);

        // Map purchases to items with product information
        const item = {
          amountInCents: Math.round(purchase.price * 100),
          productId: purchase.product_id,
          productTitle: product.title,
          brand: product.brandId,
          purchaseId: purchase.id,
        };

        if (!userProfile.billing?.stripeCustomerId) {
          this.logService.error('No Stripe customer ID found for user of order suggestion', {
            metadata: {
              userId: orderSuggestion.orders_v2.customer_id,
              orderSuggestionId: orderSuggestion.id,
            },
          });
          continue;
        }

        // Charge each item separately
        try {
          if (!userProfile.billing?.stripeCustomerId) {
            this.logService.error('No Stripe customer ID found for user of order suggestion', {
              metadata: {
                userId: orderSuggestion.orders_v2.customer_id,
                orderSuggestionId: orderSuggestion.id,
              },
            });
            return;
          }

          const tax = userProfile.address
            ? await this.billingService.calculateTax(item.amountInCents, {
                line1: userProfile.address?.addressLineOne ?? '',
                city: userProfile.address?.city ?? '',
                state: userProfile.address?.state ?? '',
                postal_code: userProfile.address?.postalCode ?? '',
                country: countryToAlpha2(userProfile.address?.country ?? 'US') ?? 'US',
              })
            : await this.billingService.calculateTax(item.amountInCents, {
                line1: '531 Page Street',
                city: 'San Francisco',
                state: 'CA',
                postal_code: '94117',
                country: 'US',
              });

          const total = item.amountInCents + tax;
          try {
            const paymentId = await this.billingService.chargeCustomer(
              userProfile.billing.stripeCustomerId,
              total,
              userProfile.email,
              {
                productPurchaseId: item.purchaseId,
                productTitle: item.productTitle,
                brand: item.brand,
              },
            );

            await supabaseDb.product_purchase.update({
              where: { id: item.purchaseId },
              data: {
                payment_status: 'paid',
                stripe_payment_id: paymentId,
              },
            });
          } catch (err) {
            this.logService.error('Error charging customer for kept items', {
              metadata: {
                userId: orderSuggestion.orders_v2.customer_id,
                orderSuggestionId: orderSuggestion.id,
                purchaseId: item.purchaseId,
                error: err,
              },
            });

            // Update payment status to payment_denied when payment fails
            await supabaseDb.product_purchase.update({
              where: { id: item.purchaseId },
              data: {
                payment_status: 'payment_denied',
              },
            });
          }
        } catch (error) {
          this.logService.error('Error charging customer for kept items', {
            error,
          });
        }
      } catch (error) {
        this.logService.error('Error charging customer for kept items', {
          error,
        });
      }
    }
  }

  async updateProductPurchase(
    request: UpdateProductPurchaseRequest,
  ): Promise<UpdateProductPurchaseResponse> {
    const { productPurchaseId, refundStatus, paymentStatus, stripePaymentId } = request;

    const productPurchase = await supabaseDb.product_purchase.findUnique({
      where: { id: productPurchaseId },
    });

    if (!productPurchase) {
      throw new ServerError(Status.NOT_FOUND, 'Product purchase not found');
    }

    const updatedProductPurchase = await supabaseDb.product_purchase.update({
      where: { id: productPurchaseId },
      data: {
        ...(refundStatus
          ? {
              refund_status:
                convertProductPurchaseRefundStatusToDbProductPurchaseRefundStatus(refundStatus),
            }
          : {}),
        ...(paymentStatus
          ? {
              payment_status: convertPaymentStatusToDbPaymentStatus(paymentStatus),
            }
          : {}),
        ...(stripePaymentId ? { stripe_payment_id: stripePaymentId } : {}),
      },
      include: {
        products_clean: true,
      },
    });

    return {
      productPurchase: await convertDbProductPurchaseToProductPurchase(updatedProductPurchase),
    };
  }

  async updateOrderSuggestionStylistNote(
    request: UpdateOrderSuggestionStylistNoteRequest,
  ): Promise<UpdateOrderSuggestionStylistNoteResponse> {
    const { orderSuggestionId, stylistNote } = request;

    await supabaseDb.order_suggestion.update({
      where: { id: orderSuggestionId },
      data: { stylist_note: stylistNote },
    });

    return {};
  }

  async publishDraftSuggestion(
    request: PublishDraftSuggestionRequest,
  ): Promise<PublishDraftSuggestionResponse> {
    const { orderSuggestionId } = request;

    await supabaseDb.order_suggestion.update({
      where: { id: orderSuggestionId },
      data: {
        status: order_suggestion_status.Pending,
        verify_suggestions_by: new Date(
          new Date().setHours(23, 59, 59, 999) + 1 * 24 * 60 * 60 * 1000,
        ),
      },
    });

    const orderSuggestion = await supabaseDb.order_suggestion.findUnique({
      where: { id: orderSuggestionId },
      include: { orders_v2: true },
    });

    if (orderSuggestion) {
      await this.sendOrderSuggestionNotification(orderSuggestionId, {
        orderId: orderSuggestion.orders_v2.id,
        userId: orderSuggestion.orders_v2.customer_id,
        isOrderFetchrInitiated: false,
      });
    }

    return {};
  }

  async removeProductSuggestionFromOrderSuggestion(
    request: RemoveProductSuggestionFromOrderSuggestionRequest,
  ): Promise<RemoveProductSuggestionFromOrderSuggestionResponse> {
    const { productSuggestionId, productPurchaseId } = request;

    if (productPurchaseId) {
      await supabaseDb.product_purchase.delete({
        where: {
          id: productPurchaseId,
        },
      });
    }
    if (productSuggestionId) {
      await supabaseDb.product_purchase_suggestion.delete({
        where: {
          id: productSuggestionId,
        },
      });
    }

    return {};
  }

  async addProductSuggestionToOrderSuggestion(
    request: AddProductSuggestionToOrderSuggestionRequest,
  ): Promise<AddProductSuggestionToOrderSuggestionResponse> {
    const { orderSuggestionId, productId, size, color } = request;

    await supabaseDb.product_purchase_suggestion.create({
      data: {
        order_suggestion_id: orderSuggestionId,
        product_id: productId,
        size: size,
        color: color,
        price: 0,
        original_price: 0,
        is_refundable: true,
      },
    });

    return {};
  }

  async deleteOrderSuggestions(
    request: DeleteOrderSuggestionsRequest,
  ): Promise<DeleteOrderSuggestionsResponse> {
    const { orderSuggestionIds } = request;

    await Promise.all(
      orderSuggestionIds.map(async orderSuggestionId => {
        await supabaseDb.product_purchase_suggestion.deleteMany({
          where: {
            order_suggestion_id: orderSuggestionId,
          },
        });

        await supabaseDb.order_suggestion.delete({
          where: {
            id: orderSuggestionId,
          },
        });
      }),
    );

    return {};
  }

  async toggleProductPurchaseSuggestionArchived(
    request: ToggleProductPurchaseSuggestionArchivedRequest,
  ): Promise<ToggleProductPurchaseSuggestionArchivedResponse> {
    const { productPurchaseSuggestionId, productPurchaseId, isArchived, archiveReason } = request;

    if (productPurchaseSuggestionId) {
      await supabaseDb.product_purchase_suggestion.update({
        where: { id: productPurchaseSuggestionId },
        data: { is_archived: isArchived, archive_reason: archiveReason },
      });
    }

    if (productPurchaseId) {
      await supabaseDb.product_purchase.update({
        where: { id: productPurchaseId },
        data: {
          is_archived: isArchived,
          archive_reason: archiveReason,
        },
      });
    }

    return {};
  }

  async editProductPurchaseSuggestion(
    request: EditProductPurchaseSuggestionRequest,
  ): Promise<EditProductPurchaseSuggestionResponse> {
    const {
      productPurchaseSuggestionId,
      productPurchaseId,
      size,
      color,
      price,
      originalPrice,
      isRefundable,
      status,
    } = request;

    // Convert status enum to database string if provided
    let dbStatus: string | undefined;
    if (status !== undefined) {
      switch (status) {
        case ProductPurchaseSuggestionStatus.PRODUCT_PURCHASE_SUGGESTION_STATUS_PENDING:
          dbStatus = 'PENDING';
          break;
        case ProductPurchaseSuggestionStatus.PRODUCT_PURCHASE_SUGGESTION_STATUS_ACCEPTED:
          dbStatus = 'APPROVED';
          break;
        case ProductPurchaseSuggestionStatus.PRODUCT_PURCHASE_SUGGESTION_STATUS_REJECTED:
          dbStatus = 'REJECTED';
          break;
      }
    }

    const updateData: {
      size: string;
      color: string;
      price: number;
      original_price?: number;
      is_refundable?: boolean;
      status?: string;
      is_accepted?: boolean;
    } = {
      size,
      color,
      price,
      original_price: originalPrice,
      is_refundable: isRefundable,
    };

    if (dbStatus !== undefined) {
      updateData.status = dbStatus;
      updateData.is_accepted = dbStatus === 'APPROVED';
    }

    await supabaseDb.product_purchase_suggestion.update({
      where: { id: productPurchaseSuggestionId },
      data: updateData,
    });

    if (productPurchaseId) {
      await supabaseDb.product_purchase.update({
        where: { id: productPurchaseId },
        data: { size, color, price, original_price: originalPrice, is_refundable: isRefundable },
      });
    }

    return {};
  }

  async deleteUserOrders(userId: string): Promise<void> {
    await supabaseDb.thread_messages.deleteMany({
      where: {
        threads: {
          product_purchase_suggestion_thread: {
            every: {
              product_purchase_suggestion: {
                order_suggestion: { orders_v2: { customer_id: userId } },
              },
            },
          },
        },
      },
    });

    // Delete product purchase suggestions since they depend on order suggestions
    await supabaseDb.product_purchase_suggestion_thread.deleteMany({
      where: {
        product_purchase_suggestion: { order_suggestion: { orders_v2: { customer_id: userId } } },
      },
    });

    await supabaseDb.product_purchase_suggestion.deleteMany({
      where: { order_suggestion: { orders_v2: { customer_id: userId } } },
    });

    await supabaseDb.product_purchase.deleteMany({
      where: { shipment: { order_suggestion: { orders_v2: { customer_id: userId } } } },
    });

    await supabaseDb.shipment.deleteMany({
      where: {
        order_suggestion: {
          orders_v2: {
            customer_id: userId,
          },
        },
      },
    });

    // Delete order suggestions first since they depend on orders
    await supabaseDb.order_suggestion.deleteMany({
      where: { orders_v2: { customer_id: userId } },
    });

    await supabaseDb.order_cart_product.deleteMany({
      where: {
        order_carts: {
          orders_v2: { customer_id: userId },
        },
      },
    });

    await supabaseDb.order_carts.deleteMany({
      where: {
        orders_v2: { customer_id: userId },
      },
    });

    // Delete product purchases since they depend on orders
    await supabaseDb.orders_v2.deleteMany({
      where: { customer_id: userId },
    });

    // Clear any cached order data
    if (REDIS_ENABLED_FOR_ORDER_MANAGEMENT_SERVICE) {
      await this.redisService.del(`orders:${userId}:all:all`, CACHE_CONFIGS.USER);
    }
  }
}
