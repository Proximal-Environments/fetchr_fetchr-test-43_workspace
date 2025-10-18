import {
  CreateOrderRequest,
  CreateOrderResponse,
  GetOrderRequest,
  GetOrderResponse,
  ListOrdersRequest,
  ListOrdersResponse,
  UpdateOrderRequest,
  UpdateOrderResponse,
  DeleteOrderRequest,
  DeleteOrderResponse,
  OrderManagementServiceImplementation,
  GetEnrichedOrderResponse,
  CreateOrderSuggestionRequest,
  SubmitOrderSuggestionUserResponseRequest,
  AddShipmentToOrderSuggestionRequest,
  AddShipmentToOrderSuggestionResponse,
  UpdateShippingInformationRequest,
  DeleteShipmentRequest,
  SubmitProductPurchaseFeedbackRequest,
  SubmitProductPurchaseSuggestionFeedbackRequest,
  SubmitProductPurchaseSuggestionFeedbackResponse,
  FinalizeOrderSuggestionRequest,
  FinalizeOrderSuggestionResponse,
  ReplaceOrderSuggestionResponse,
  ReplaceOrderSuggestionRequest,
  SetSuggestionArchivedRequest,
  SetSuggestionArchivedResponse,
  GetShipmentIntentInfoRequest,
  GetShipmentIntentInfoResponse,
  UpdateProductPurchaseResponse,
  UpdateProductPurchaseRequest,
  UpdateOrderSuggestionStylistNoteRequest,
  UpdateOrderSuggestionStylistNoteResponse,
  PublishDraftSuggestionResponse,
  PublishDraftSuggestionRequest,
  RemoveProductSuggestionFromOrderSuggestionResponse,
  RemoveProductSuggestionFromOrderSuggestionRequest,
  AddProductSuggestionToOrderSuggestionResponse,
  AddProductSuggestionToOrderSuggestionRequest,
  DeleteOrderSuggestionsRequest,
  DeleteOrderSuggestionsResponse,
  ToggleProductPurchaseSuggestionArchivedRequest,
  ToggleProductPurchaseSuggestionArchivedResponse,
  EditProductPurchaseSuggestionRequest,
  EditProductPurchaseSuggestionResponse,
} from '@fetchr/schema/orderManagement/orderManagement';
import { brexService, orderManagementService, perf } from '../fetchr/base/service_injection/global';
import { convertOrderStatusToDbOrderStatus, convertUserRoleToDbRole } from '../shared/converters';
import { getRequestUser } from '../fetchr/base/logging/requestContext';
import { Empty, UserRole } from '@fetchr/schema/base/base';
import { ServerError, Status } from 'nice-grpc';
import { DEFAULT_EMAIL } from '../fetchr/modules/shipping/shippingEmailService';
import { supabaseDb } from '../fetchr/base/database/supabaseDb';
import { logService } from '../fetchr/base/logging/logService';

export class OrderManagementServer implements OrderManagementServiceImplementation {
  async createOrder(request: CreateOrderRequest): Promise<CreateOrderResponse> {
    const customerId = request.customerId;
    const currentRequestUser = getRequestUser();
    const targetUserId = customerId ?? currentRequestUser?.id;
    if (!targetUserId) {
      throw new Error('Customer ID is required');
    } else if (
      targetUserId !== currentRequestUser?.id &&
      currentRequestUser?.role !== UserRole.USER_ROLE_ADMIN
    ) {
      logService.error(
        `User does not have permission to create order. They are role: ${
          currentRequestUser?.role ? convertUserRoleToDbRole(currentRequestUser.role) : 'unknown'
        } and target user id: ${targetUserId}`,
        {
          metadata: {
            targetUserId,
            currentRequestUser,
          },
        },
      );
      throw new Error('User does not have permission to create order');
    }

    // If chatId is empty string, treat it as undefined
    const chatId = request.chatId === '' ? undefined : request.chatId;

    const order = await orderManagementService.createOrder(
      targetUserId,
      request.productRecommendations,
      chatId,
      request.stylistId,
      request.note,
      request.type,
    );
    return { order };
  }

  async getOrder(request: GetOrderRequest): Promise<GetOrderResponse> {
    try {
      const order = await orderManagementService.getOrder(request.orderId);
      return { order };
    } catch (error) {
      logService.error('Error in get_order:', {
        error: error as Error,
        metadata: { method: 'getOrder', orderId: request.orderId },
      });
      throw error;
    }
  }

  async listOrders(request: ListOrdersRequest): Promise<ListOrdersResponse> {
    return perf.track('listOrders', async () => {
      const currentRequestUser = getRequestUser();
      if (!currentRequestUser) {
        throw new Error('User must be authenticated to list orders');
      }

      // If customerId is provided, verify the user has permission to view those orders
      if (
        request.customerId &&
        request.customerId !== currentRequestUser.id &&
        currentRequestUser.role !== UserRole.USER_ROLE_ADMIN
      ) {
        logService.error(
          `User does not have permission to list orders. They are role: ${
            currentRequestUser.role ? convertUserRoleToDbRole(currentRequestUser.role) : 'unknown'
          } and target user id: ${request.customerId}`,
          {
            metadata: {
              targetUserId: request.customerId,
              currentRequestUser,
            },
          },
        );
        throw new Error('User does not have permission to list orders');
      }

      const orders = await orderManagementService.listOrders(
        request.customerId,
        request.stylistId,
        request.status ? convertOrderStatusToDbOrderStatus(request.status) : undefined,
        request.shouldIncludeArchivedSuggestions ?? true,
      );
      logService.info('Sample order:', {
        metadata: {
          order: orders[0],
        },
      });
      return { orders };
    });
  }

  async updateOrder(request: UpdateOrderRequest): Promise<UpdateOrderResponse> {
    const order = await orderManagementService.updateOrder(
      request.orderId,
      request.stylistId,
      request.status,
      undefined,
      request.isStarred,
    );

    return { order };
  }

  async deleteOrder(request: DeleteOrderRequest): Promise<DeleteOrderResponse> {
    const success = await orderManagementService.deleteOrder(request.orderId);
    return { success };
  }

  async getEnrichedOrder(request: GetOrderRequest): Promise<GetEnrichedOrderResponse> {
    try {
      const enrichedOrder = await orderManagementService.getEnrichedOrder(request.orderId);

      return { enrichedOrder };
    } catch (error) {
      logService.error('Error in get_enriched_order:', {
        error: error as Error,
        metadata: { method: 'getEnrichedOrder', orderId: request.orderId },
      });
      throw error;
    }
  }

  // New Flow
  async createOrderSuggestion(request: CreateOrderSuggestionRequest): Promise<Empty> {
    await orderManagementService.createOrderSuggestion(request);
    return {};
  }

  async submitOrderSuggestionUserResponse(
    request: SubmitOrderSuggestionUserResponseRequest,
  ): Promise<Empty> {
    await orderManagementService.submitOrderSuggestionUserResponse(request);
    return {};
  }

  async addShipmentToOrderSuggestion(
    request: AddShipmentToOrderSuggestionRequest,
  ): Promise<AddShipmentToOrderSuggestionResponse> {
    const { shipmentId } = await orderManagementService.addShipmentToOrderSuggestion(request);
    return { shipmentId };
  }

  async updateShippingInformation(request: UpdateShippingInformationRequest): Promise<Empty> {
    await orderManagementService.updateShippingInformation(request);
    return {};
  }
  async deleteShipment(request: DeleteShipmentRequest): Promise<Empty> {
    await orderManagementService.deleteShipment(request.shipmentId);
    return {};
  }

  async submitProductPurchaseFeedback(
    request: SubmitProductPurchaseFeedbackRequest,
  ): Promise<Empty> {
    await orderManagementService.submitProductPurchaseFeedback(request);
    return {};
  }

  async submitProductPurchaseSuggestionFeedback(
    request: SubmitProductPurchaseSuggestionFeedbackRequest,
  ): Promise<SubmitProductPurchaseSuggestionFeedbackResponse> {
    const { productPurchaseSuggestion } =
      await orderManagementService.submitProductPurchaseSuggestionFeedback(request);
    return { productPurchaseSuggestion };
  }

  async finalizeOrderSuggestion(
    request: FinalizeOrderSuggestionRequest,
  ): Promise<FinalizeOrderSuggestionResponse> {
    const currentUser = getRequestUser();
    if (!currentUser) {
      throw new ServerError(Status.UNAUTHENTICATED, 'User not authenticated');
    }

    const { orderSuggestion } = await orderManagementService.finalizeOrderSuggestion(
      request,
      currentUser.id,
    );
    return { orderSuggestion };
  }

  async replaceOrderSuggestion(
    request: ReplaceOrderSuggestionRequest,
  ): Promise<ReplaceOrderSuggestionResponse> {
    const { orderSuggestion } = await orderManagementService.replaceOrderSuggestion(request);
    return { orderSuggestion };
  }

  async setSuggestionArchived(
    request: SetSuggestionArchivedRequest,
  ): Promise<SetSuggestionArchivedResponse> {
    await orderManagementService.setSuggestionArchived(
      request.orderSuggestionId,
      request.isArchived,
    );
    return { message: 'successful' };
  }

  async getShipmentIntentInfo(
    request: GetShipmentIntentInfoRequest,
  ): Promise<GetShipmentIntentInfoResponse> {
    void request;

    if (getRequestUser()?.role !== UserRole.USER_ROLE_ADMIN) {
      throw new ServerError(
        Status.PERMISSION_DENIED,
        'User does not have permission to get shipment intent info',
      );
    }

    let email = undefined;
    while (
      !email ||
      (await supabaseDb.shipment.findFirst({ where: { unique_email_address: email } }))
    ) {
      const shipmentSlug = generateRandomId(6);
      const [localPart, domain] = DEFAULT_EMAIL.split('@');
      email = `${localPart}+${shipmentSlug}@${domain}`;
    }

    const { id: cardId } = await brexService.createTemporaryVirtualCard();
    const creditCard = await brexService.getCard(cardId);

    await supabaseDb.cards_to_terminate.create({
      data: {
        card_id: cardId,
        terminate_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30), // 30 days from now
        lock_at: new Date(Date.now() + 1000 * 60 * 60 * 24), // 1 day from now
      },
    });

    return { email, creditCard };
  }

  async updateProductPurchase(
    request: UpdateProductPurchaseRequest,
  ): Promise<UpdateProductPurchaseResponse> {
    const { productPurchase } = await orderManagementService.updateProductPurchase(request);
    return { productPurchase };
  }

  async updateOrderSuggestionStylistNote(
    request: UpdateOrderSuggestionStylistNoteRequest,
  ): Promise<UpdateOrderSuggestionStylistNoteResponse> {
    await orderManagementService.updateOrderSuggestionStylistNote(request);
    return {};
  }

  async publishDraftSuggestion(
    request: PublishDraftSuggestionRequest,
  ): Promise<PublishDraftSuggestionResponse> {
    await orderManagementService.publishDraftSuggestion(request);
    return {};
  }

  async removeProductSuggestionFromOrderSuggestion(
    request: RemoveProductSuggestionFromOrderSuggestionRequest,
  ): Promise<RemoveProductSuggestionFromOrderSuggestionResponse> {
    await orderManagementService.removeProductSuggestionFromOrderSuggestion(request);
    return {};
  }

  async addProductSuggestionToOrderSuggestion(
    request: AddProductSuggestionToOrderSuggestionRequest,
  ): Promise<AddProductSuggestionToOrderSuggestionResponse> {
    await orderManagementService.addProductSuggestionToOrderSuggestion(request);
    return {};
  }

  async deleteOrderSuggestions(
    request: DeleteOrderSuggestionsRequest,
  ): Promise<DeleteOrderSuggestionsResponse> {
    await orderManagementService.deleteOrderSuggestions(request);
    return {};
  }

  async toggleProductPurchaseSuggestionArchived(
    request: ToggleProductPurchaseSuggestionArchivedRequest,
  ): Promise<ToggleProductPurchaseSuggestionArchivedResponse> {
    await orderManagementService.toggleProductPurchaseSuggestionArchived(request);
    return {};
  }

  async editProductPurchaseSuggestion(
    request: EditProductPurchaseSuggestionRequest,
  ): Promise<EditProductPurchaseSuggestionResponse> {
    await orderManagementService.editProductPurchaseSuggestion(request);
    return {};
  }
}
function generateRandomId(length: number = 6): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join(
    '',
  );
}
