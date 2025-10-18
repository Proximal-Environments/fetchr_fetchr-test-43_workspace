import {
  brands,
  order_suggestion_status,
  Prisma,
  product_purchase,
  products_clean,
  shipment,
} from "@prisma/client";
import {
  Brand,
  OrderSuggestionDetailedStatus,
  OrderSuggestionStatus,
  PopulatedOrderSuggestion,
  ProductPurchase,
  ProductPurchaseSuggestion,
  ProductPurchaseSuggestionStatus,
  Shipment,
  ShipmentStatus,
} from "@fetchr/schema/base/base";
import {
  convertDbGenderToGender,
  convertDbPaymentStatusToPaymentStatus,
  convertDbProductPurchaseFeedbackCategoryToProductPurchaseFeedbackCategory,
  convertDbProductPurchaseRefundStatusToProductPurchaseRefundStatus,
  convertDbProductPurchaseSuggestionStatusToProductPurchaseSuggestionStatus,
  convertDbShipmentStatusToShipmentStatus,
  convertDbThreadStatusToThreadStatus,
  convertDbThreadTypeToThreadType,
} from "../../../shared/converters";
import { productService } from "../../base/service_injection/global";

export function convertDbOrderSuggestionStatusToOrderSuggestionStatus(
  status: order_suggestion_status
): OrderSuggestionStatus {
  switch (status) {
    case "Pending":
      return OrderSuggestionStatus.ORDER_SUGGESTION_STATUS_PENDING;
    case "Reviewed":
      return OrderSuggestionStatus.ORDER_SUGGESTION_STATUS_REVIEWED;
    case "Archived":
      return OrderSuggestionStatus.ORDER_SUGGESTION_STATUS_ARCHIVED;
    case "Draft":
      return OrderSuggestionStatus.ORDER_SUGGESTION_STATUS_DRAFT;
    default:
      throw new Error(`Invalid order suggestion status: ${status}`);
  }
}

export async function convertDbProductPurchaseSuggestionToProductPurchaseSuggestion(
  productPurchaseSuggestion: Prisma.product_purchase_suggestionGetPayload<{
    include: {
      products_clean: true;
      product_purchase_suggestion_thread: {
        include: {
          threads: {
            include: {
              thread_messages: true;
            };
          };
        };
      };
    };
  }>
): Promise<ProductPurchaseSuggestion> {
  return {
    id: productPurchaseSuggestion.id,
    productId: productPurchaseSuggestion.product_id,
    size: productPurchaseSuggestion.size,
    price: productPurchaseSuggestion.price,
    originalPrice: productPurchaseSuggestion.original_price,
    isRefundable: productPurchaseSuggestion.is_refundable,
    isAccepted: productPurchaseSuggestion.is_accepted,
    product: await productService.convertDbProductToProduct(
      productPurchaseSuggestion.products_clean
    ),
    color: productPurchaseSuggestion.color,
    note: productPurchaseSuggestion.note ?? undefined,
    status:
      convertDbProductPurchaseSuggestionStatusToProductPurchaseSuggestionStatus(
        productPurchaseSuggestion.status
      ),
    aiJudgeAnalysis: productPurchaseSuggestion.ai_judge_analysis ?? undefined,
    isArchived: productPurchaseSuggestion.is_archived ?? false,
    archiveReason: productPurchaseSuggestion.archive_reason ?? undefined,
    internalData: {
      threads: productPurchaseSuggestion.product_purchase_suggestion_thread
        .map((ppsThread) => {
          if (ppsThread.threads === null) {
            return undefined;
          }

          return {
            id: Number(ppsThread.threads.id),
            type: convertDbThreadTypeToThreadType(
              ppsThread.threads.thread_type
            ),
            createdAt: ppsThread.threads.created_at.getTime(),
            messages: ppsThread.threads.thread_messages.map((message) => ({
              id: Number(message.id),
              content: message.content,
              createdAt: message.created_at.getTime(),
              userId: message.user_id,
              userName: message.user_name,
            })),
            status: convertDbThreadStatusToThreadStatus(
              ppsThread.threads.thread_status
            ),
          };
        })
        .filter((thread) => thread !== undefined)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((thread) => ({
          ...thread,
          messages: thread.messages.sort((a, b) => a.createdAt - b.createdAt),
        })),
    },
  };
}

function getOrderSuggestionDetailedStatus(
  orderSuggestionWithoutDetailedStatus: Omit<
    PopulatedOrderSuggestion,
    "detailedStatus"
  >
): OrderSuggestionDetailedStatus {
  if (orderSuggestionWithoutDetailedStatus.productSuggestions.length === 0) {
    return OrderSuggestionDetailedStatus.ORDER_SUGGESTION_DETAILED_STATUS_FINDING_ITEMS;
  }

  if (
    orderSuggestionWithoutDetailedStatus.status ===
      OrderSuggestionStatus.ORDER_SUGGESTION_STATUS_PENDING ||
    orderSuggestionWithoutDetailedStatus.productSuggestions.some(
      (suggestion) =>
        suggestion.status ===
        ProductPurchaseSuggestionStatus.PRODUCT_PURCHASE_SUGGESTION_STATUS_PENDING
    )
  ) {
    return OrderSuggestionDetailedStatus.ORDER_SUGGESTION_DETAILED_STATUS_PENDING_VERIFICATION;
  }

  const shipments = orderSuggestionWithoutDetailedStatus.shipments;
  if (
    shipments.length > 0 &&
    shipments.every(
      (shipment) => shipment.status === ShipmentStatus.SHIPMENT_STATUS_DELIVERED
    )
  ) {
    return OrderSuggestionDetailedStatus.ORDER_SUGGESTION_DETAILED_STATUS_DELIVERED;
  }

  if (shipments.length > 0) {
    return OrderSuggestionDetailedStatus.ORDER_SUGGESTION_DETAILED_STATUS_SHIPPING;
  }

  if (
    orderSuggestionWithoutDetailedStatus.productSuggestions.some(
      (suggestion) =>
        suggestion.status ===
        ProductPurchaseSuggestionStatus.PRODUCT_PURCHASE_SUGGESTION_STATUS_ACCEPTED
    )
  ) {
    return OrderSuggestionDetailedStatus.ORDER_SUGGESTION_DETAILED_STATUS_PENDING_PURCHASE;
  }

  return OrderSuggestionDetailedStatus.ORDER_SUGGESTION_DETAILED_STATUS_MODIFYING_ITEMS;
}

export async function convertDbOrderSuggestionsToOrderSuggestion(
  orderSuggestion: Prisma.order_suggestionGetPayload<{
    include: {
      product_purchase_suggestion: {
        include: {
          products_clean: true;
          product_purchase_suggestion_thread: {
            include: {
              threads: {
                include: {
                  thread_messages: true;
                };
              };
            };
          };
        };
      };
      shipment: {
        include: {
          product_purchase: {
            include: {
              products_clean: true;
            };
          };
        };
      };
    };
  }>
): Promise<PopulatedOrderSuggestion> {
  // export interface PopulatedOrderSuggestion {
  //   id: string;
  //   createdAt: number;
  //   status: OrderSuggestionStatus;
  //   productSuggestions: ProductPurchaseSuggestion[];
  //   shipments: Shipment[];
  // }

  const shipments = await Promise.all(
    orderSuggestion.shipment.map(convertDbShipmentToShipment)
  );

  const orderSuggestionWithoutDetailedStatus: Omit<
    PopulatedOrderSuggestion,
    "detailedStatus"
  > = {
    id: orderSuggestion.id,
    createdAt: orderSuggestion.created_at.getTime(),
    status: convertDbOrderSuggestionStatusToOrderSuggestionStatus(
      orderSuggestion.status
    ),
    productSuggestions: await Promise.all(
      orderSuggestion.product_purchase_suggestion.map(
        convertDbProductPurchaseSuggestionToProductPurchaseSuggestion
      )
    ),
    shipments,
    verifySuggestionsBy: orderSuggestion.verify_suggestions_by?.getTime(),
    expireSuggestionsBy: orderSuggestion.expire_suggestions_by?.getTime(),
    verifyPurchasesBy: orderSuggestion.verify_purchase_by
      ? Math.max(
          new Date(orderSuggestion.verify_purchase_by).getTime(),
          shipments.length > 0 &&
            shipments.every(
              (s) =>
                s.deliveredAt &&
                s.status === ShipmentStatus.SHIPMENT_STATUS_DELIVERED
            )
            ? Math.min(...shipments.map((s) => s.deliveredAt ?? 0)) +
                7 * 24 * 60 * 60 * 1000
            : 0
        )
      : shipments.length > 0 &&
          shipments.every(
            (s) =>
              s.deliveredAt &&
              s.status === ShipmentStatus.SHIPMENT_STATUS_DELIVERED
          )
        ? Math.min(...shipments.map((s) => s.deliveredAt ?? 0)) +
          7 * 24 * 60 * 60 * 1000
        : 0,
    stylistNote: orderSuggestion.stylist_note ?? undefined,
    aiJudgeAnalysis: orderSuggestion.ai_judge_analysis ?? undefined,
  };

  return {
    ...orderSuggestionWithoutDetailedStatus,
    detailedStatus: getOrderSuggestionDetailedStatus(
      orderSuggestionWithoutDetailedStatus
    ),
  };
}

export async function convertDbProductPurchaseToProductPurchase(
  productPurchase: Prisma.product_purchaseGetPayload<{
    include: {
      products_clean: true;
    };
  }>
): Promise<ProductPurchase> {
  // id: string;
  // productId: string;
  // size: string;
  // price: number;
  // originalPrice?: number | undefined;
  // isRefundable?: boolean | undefined;
  return {
    id: productPurchase.id,
    productId: productPurchase.product_id,
    size: productPurchase.size,
    price: productPurchase.price,
    originalPrice: productPurchase.original_price,
    isRefundable: productPurchase.is_refundable,
    product: productPurchase.products_clean
      ? await productService.convertDbProductToProduct(
          productPurchase.products_clean
        )
      : undefined,
    color: productPurchase.color,
    refundStatus:
      convertDbProductPurchaseRefundStatusToProductPurchaseRefundStatus(
        productPurchase.refund_status
      ),
    paymentStatus: convertDbPaymentStatusToPaymentStatus(
      productPurchase.payment_status
    ),
    stripePaymentId: productPurchase.stripe_payment_id ?? undefined,
    userFeedback: productPurchase.user_feedback_note
      ? {
          feedback: productPurchase.user_feedback_note,
          categories: productPurchase.user_feedback_categories.map(
            convertDbProductPurchaseFeedbackCategoryToProductPurchaseFeedbackCategory
          ),
        }
      : undefined,
    isArchived: productPurchase.is_archived,
    archiveReason: productPurchase.archive_reason ?? undefined,
  };
}

export async function convertDbProductPurchasesToProductPurchases(
  productPurchases: Prisma.product_purchaseGetPayload<{
    include: {
      products_clean: true;
    };
  }>[]
): Promise<ProductPurchase[]> {
  const products = await productService.convertDbProductToProductBatch(
    productPurchases.map((productPurchase) => productPurchase.products_clean)
  );

  const productMap = new Map(products.map((product) => [product.id, product]));

  return Promise.all(
    productPurchases
      .filter((productPurchase) => productMap.has(productPurchase.product_id))
      .map(
        async (productPurchase): Promise<ProductPurchase> =>
          convertDbProductPurchaseToProductPurchase(productPurchase)
      )
  );
}

export async function convertDbShipmentToShipment(
  shipment: Prisma.shipmentGetPayload<{
    include: {
      product_purchase: {
        include: {
          products_clean: true;
        };
      };
      brands: true;
      order_suggestion: true;
    };
  }>
): Promise<Shipment> {
  // export type $shipmentPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
  //   name: "shipment"
  //   objects: {
  //     product_purchase: Prisma.$product_purchasePayload<ExtArgs>[]
  //     brands: Prisma.$brandsPayload<ExtArgs>
  //     order_suggestion: Prisma.$order_suggestionPayload<ExtArgs>
  //   }
  //   scalars: $Extensions.GetPayloadResult<{
  //     created_at: Date
  //     product_purchase_ids: bigint[]
  //     tracking_url: string | null
  //     tracking_number: string | null
  //     expected_delivery_date_start: Date | null
  //     expected_delivery_date_end: Date | null
  //     brand_id: string
  //     status: $Enums.shipment_status
  //     brand_order_number: string | null
  //     id: string
  //     order_suggestion_id: string
  //   }, ExtArgs["result"]["shipment"]>
  //   composites: {}
  // }
  // export interface Shipment {
  //   id: string;
  //   orderId: string;
  //   brand: Brand | undefined;
  //   productPurchases: ProductPurchase[];
  //   status: ShipmentStatus;
  //   /** Shipment tracking info */
  //   brandOrderId?: string | undefined;
  //   trackingNumber?: string | undefined;
  //   trackingUrl?: string | undefined;
  //   expectedDeliveryDateStart?: number | undefined;
  //   expectedDeliveryDateEnd?: number | undefined;
  // }
  return {
    id: shipment.id,
    orderId: shipment.order_suggestion_id,
    brand: shipment.brands ? convertDbBrandToBrand(shipment.brands) : undefined,
    productPurchases: await convertDbProductPurchasesToProductPurchases(
      shipment.product_purchase
    ),
    status: convertDbShipmentStatusToShipmentStatus(shipment.status),
    trackingNumber: shipment.tracking_number ?? undefined,
    trackingUrl: shipment.tracking_url ?? undefined,
    expectedDeliveryDateStart: shipment.expected_delivery_date_start?.getTime(),
    expectedDeliveryDateEnd: shipment.expected_delivery_date_end?.getTime(),
    deliveredAt: shipment.delivered_at?.getTime(),
    email: shipment.unique_email_address ?? undefined,
    possibleTrackingNumbers: shipment.possible_tracking_numbers ?? [],
  };
}

export function convertDbBrandToBrand(brand: brands): Brand {
  return {
    id: brand.id,
    company: brand.company,
    url: brand.url,
    gender: brand.gender ? convertDbGenderToGender(brand.gender) : undefined,
    gptSummary: brand.gpt_summary ?? undefined,
  };
}

export function convertDbBrandToBrandBatch(brands: brands[]): Brand[] {
  return brands.map((brand) => ({
    id: brand.id,
    company: brand.company,
    url: brand.url,
    gender: brand.gender ? convertDbGenderToGender(brand.gender) : undefined,
    gptSummary: brand.gpt_summary ?? undefined,
  }));
}

export async function convertDbShipmentToShipmentBatch(
  shipments: (shipment & {
    brands: brands | null;
    product_purchase: (product_purchase & {
      products_clean: products_clean;
    })[];
  })[]
): Promise<Shipment[]> {
  const brands = convertDbBrandToBrandBatch(
    shipments
      .map((shipment) => shipment.brands)
      .filter((brand): brand is brands => brand !== null)
  );

  const brandMap = new Map(brands.map((brand) => [brand.id, brand]));

  const productPurchases = await convertDbProductPurchasesToProductPurchases(
    shipments.flatMap((shipment) => shipment.product_purchase)
  );

  const productPurchaseMap = new Map(
    productPurchases.map((productPurchase) => [
      productPurchase.id,
      productPurchase,
    ])
  );

  const convertedShipments = await Promise.all(
    shipments.map(async (shipment): Promise<Shipment | undefined> => {
      const productPurchases = shipment.product_purchase.map(
        (productPurchase) => productPurchaseMap.get(productPurchase.id)
      );

      const brand = brandMap.get(shipment.brand_id);

      if (
        !brand ||
        productPurchases.some((productPurchase) => !productPurchase)
      ) {
        return undefined;
      }

      return {
        id: shipment.id,
        orderId: shipment.order_suggestion_id,
        brand,
        productPurchases: productPurchases as ProductPurchase[],
        status: convertDbShipmentStatusToShipmentStatus(shipment.status),
        trackingNumber: shipment.tracking_number ?? undefined,
        trackingUrl: shipment.tracking_url ?? undefined,
        expectedDeliveryDateStart:
          shipment.expected_delivery_date_start?.getTime(),
        expectedDeliveryDateEnd: shipment.expected_delivery_date_end?.getTime(),
        deliveredAt: shipment.delivered_at?.getTime(),
        possibleTrackingNumbers: shipment.possible_tracking_numbers ?? [],
      };
    })
  );

  return convertedShipments.filter(
    (shipment): shipment is Shipment => shipment !== undefined
  );
}
