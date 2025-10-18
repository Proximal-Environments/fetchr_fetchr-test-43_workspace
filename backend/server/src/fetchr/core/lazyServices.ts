/* eslint-disable @typescript-eslint/no-var-requires */
// Lazy service loader that breaks circular dependencies
// by loading services only when first accessed

// Type imports only
import type { OpenAIService } from './open_ai/openaiService';
import type { ProductPreferenceService } from '../modules/explore/productPreferencesService';
import type { ProductSearchService } from '../modules/product/productSearchService';
import type { Perf } from './performance/performance';
import type { S3Service } from './aws/s3/s3Service';
import type { SupabaseStorageService } from './supabase/supabaseStorageService';
import type { RedisService } from './redis/redisService';
import type { AnthropicService } from './anthropic/anthropicService';
import type { PineconeService } from './pinecone/pineconeService';
import type { ImagePreferenceService } from '../modules/explore/imagePreferencesService';
import type { ProductImageService } from './productImage/productImageService';
import type { NotificationsService } from '../modules/notifications/notificationsService';
import type { PinterestService } from '../modules/pinterest/pinterestService';
import type { UserService } from '../modules/user/userService';
import type { LogService } from '../base/logging/logService';
import type { ProductService } from '../modules/product/productService';
import { ShippingEmailService } from '../modules/shipping/shippingEmailService';
import { OrderManagementService } from '../modules/orderManagement/orderManagementsService';
import { OrderAutomationService } from '../modules/orderAutomation/orderAutomationService';
import { GroqService } from './groq/groqService';
import { CommentingService } from '../modules/commenting/commentingService';

// Define the ServiceMap type with all available services
export interface ServiceMap {
  logService: LogService;
  openAIService: OpenAIService;
  anthropicService: AnthropicService;
  productPreferenceService: ProductPreferenceService;
  productSearchService: ProductSearchService;
  perfService: Perf;
  s3Service: S3Service;
  supabaseStorageService: SupabaseStorageService;
  redisService: RedisService;
  pineconeService: PineconeService;
  imagePreferenceService: ImagePreferenceService;
  productImageService: ProductImageService;
  notificationsService: NotificationsService;
  pinterestService: PinterestService;
  userService: UserService;
  productService: ProductService;
  shippingEmailService: ShippingEmailService;
  orderManagementService: OrderManagementService;
  orderAutomationService: OrderAutomationService;
  groqService: GroqService;
  commentingService: CommentingService;
}

// Service instances
let _logService: LogService;
let _openAIService: OpenAIService;
let _anthropicService: AnthropicService;
let _productPreferenceService: ProductPreferenceService;
let _productSearchService: ProductSearchService;
let _perf: Perf;
let _s3Service: S3Service;
let _supabaseStorageService: SupabaseStorageService;
let _redisService: RedisService;
let _pineconeService: PineconeService;
let _imagePreferenceService: ImagePreferenceService;
let _productImageService: ProductImageService;
let _notificationsService: NotificationsService;
let _pinterestService: PinterestService;
let _userService: UserService;
let _productService: ProductService;
let _shippingEmailService: ShippingEmailService;
let _orderManagementService: OrderManagementService;
let _orderAutomationService: OrderAutomationService;
let _groqService: GroqService;
let _commentingService: CommentingService;

export async function getLogService(): Promise<LogService> {
  if (!_logService) {
    const { logService } = await import('../base/logging/logService');
    _logService = logService;
  }
  return _logService;
}

export async function getShippingEmailService(): Promise<ShippingEmailService> {
  if (!_shippingEmailService) {
    const { shippingEmailService } = await import('../base/service_injection/global');
    _shippingEmailService = shippingEmailService;
  }
  return _shippingEmailService;
}

export async function getOpenAIService(): Promise<OpenAIService> {
  if (!_openAIService) {
    const { openAIService } = await import('../base/service_injection/global');
    _openAIService = openAIService;
  }
  return _openAIService;
}

export async function getGroqService(): Promise<GroqService> {
  if (!_groqService) {
    const { groqService } = await import('../base/service_injection/global');
    _groqService = groqService;
  }
  return _groqService;
}

export async function getAnthropicService(): Promise<AnthropicService> {
  if (!_anthropicService) {
    const { anthropicService } = await import('../base/service_injection/global');
    _anthropicService = anthropicService;
  }
  return _anthropicService;
}

export async function getProductPreferenceService(): Promise<ProductPreferenceService> {
  if (!_productPreferenceService) {
    const { productPreferenceService } = await import('../base/service_injection/global');
    _productPreferenceService = productPreferenceService;
  }
  return _productPreferenceService;
}

export async function getProductSearchService(): Promise<ProductSearchService> {
  if (!_productSearchService) {
    const { productSearchService } = await import('../base/service_injection/global');
    _productSearchService = productSearchService;
  }
  return _productSearchService;
}

export async function getPerfService(): Promise<Perf> {
  if (!_perf) {
    const { perf } = await import('../base/service_injection/global');
    _perf = perf;
  }
  return _perf;
}

export async function getS3Service(): Promise<S3Service> {
  if (!_s3Service) {
    const { s3Service } = await import('../base/service_injection/global');
    _s3Service = s3Service;
  }
  return _s3Service;
}

export async function getSupabaseStorageService(): Promise<SupabaseStorageService> {
  if (!_supabaseStorageService) {
    const { supabaseStorageService } = await import('../base/service_injection/global');
    _supabaseStorageService = supabaseStorageService;
  }
  return _supabaseStorageService;
}

export async function getRedisService(): Promise<RedisService> {
  if (!_redisService) {
    const { redisService } = await import('../base/service_injection/global');
    _redisService = redisService;
  }
  return _redisService;
}

export async function getPineconeService(): Promise<PineconeService> {
  if (!_pineconeService) {
    const { pineconeService } = await import('../base/service_injection/global');
    _pineconeService = pineconeService;
  }
  return _pineconeService;
}

export async function getImagePreferenceService(): Promise<ImagePreferenceService> {
  if (!_imagePreferenceService) {
    const { imagePreferenceService } = await import('../base/service_injection/global');
    _imagePreferenceService = imagePreferenceService;
  }
  return _imagePreferenceService;
}

export async function getProductImageService(): Promise<ProductImageService> {
  if (!_productImageService) {
    const { productImageService } = await import('../base/service_injection/global');
    _productImageService = productImageService;
  }
  return _productImageService;
}

export async function getNotificationsService(): Promise<NotificationsService> {
  if (!_notificationsService) {
    const { notificationsService } = await import('../base/service_injection/global');
    _notificationsService = notificationsService;
  }
  return _notificationsService;
}

export async function getPinterestService(): Promise<PinterestService> {
  if (!_pinterestService) {
    const { pinterestService } = await import('../base/service_injection/global');
    _pinterestService = pinterestService;
  }
  return _pinterestService;
}

export async function getUserService(): Promise<UserService> {
  if (!_userService) {
    const { userService } = await import('../base/service_injection/global');
    _userService = userService;
  }
  return _userService;
}

export async function getProductService(): Promise<ProductService> {
  if (!_productService) {
    const { productService } = await import('../base/service_injection/global');
    _productService = productService;
  }
  return _productService;
}

export async function getOrderManagementService(): Promise<OrderManagementService> {
  if (!_orderManagementService) {
    const { orderManagementService } = await import('../base/service_injection/global');
    _orderManagementService = orderManagementService;
  }
  return _orderManagementService;
}

export async function getOrderAutomationService(): Promise<OrderAutomationService> {
  if (!_orderAutomationService) {
    const { orderAutomationService } = await import('../base/service_injection/global');
    _orderAutomationService = orderAutomationService;
  }
  return _orderAutomationService;
}

export async function getCommentingService(): Promise<CommentingService> {
  if (!_commentingService) {
    const { commentingService } = await import('../base/service_injection/global');
    _commentingService = commentingService;
  }
  return _commentingService;
}

export async function initLazyServices(): Promise<ServiceMap> {
  try {
    const [
      logService,
      openAIService,
      anthropicService,
      productPreferenceService,
      productSearchService,
      perfService,
      s3Service,
      supabaseStorageService,
      redisService,
      pineconeService,
      imagePreferenceService,
      productImageService,
      notificationsService,
      pinterestService,
      userService,
      productService,
      shippingEmailService,
      orderManagementService,
      orderAutomationService,
      groqService,
      commentingService,
    ] = await Promise.all([
      getLogService(),
      getOpenAIService(),
      getAnthropicService(),
      getProductPreferenceService(),
      getProductSearchService(),
      getPerfService(),
      getS3Service(),
      getSupabaseStorageService(),
      getRedisService(),
      getPineconeService(),
      getImagePreferenceService(),
      getProductImageService(),
      getNotificationsService(),
      getPinterestService(),
      getUserService(),
      getProductService(),
      getShippingEmailService(),
      getOrderManagementService(),
      getOrderAutomationService(),
      getGroqService(),
      getCommentingService(),
    ]);

    return {
      logService,
      openAIService,
      anthropicService,
      productPreferenceService,
      productSearchService,
      perfService,
      s3Service,
      supabaseStorageService,
      redisService,
      pineconeService,
      imagePreferenceService,
      productImageService,
      notificationsService,
      pinterestService,
      userService,
      productService,
      shippingEmailService,
      orderManagementService,
      orderAutomationService,
      groqService,
      commentingService,
    };
  } catch (error) {
    throw new Error(
      `Failed to initialize lazy services: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    );
  }
}
