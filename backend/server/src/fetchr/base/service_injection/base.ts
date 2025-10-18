import { Container } from 'inversify';
import { LogService } from '../logging/logService';
import 'reflect-metadata';
import { S3Service } from '../../core/aws/s3/s3Service';
import { UserService } from '../../modules/user/userService';
import { OpenAIService } from '../../core/open_ai/openaiService';
import { EmbeddingsService } from '../../core/embeddings/embeddingsService';
import { PineconeService } from '../../core/pinecone/pineconeService';
import { SiglipService } from '../../core/siglip/siglipService';
import { ExploreRequestService } from '../../modules/explore/exploreRequestService';
import { ProductPreferenceService } from '../../modules/explore/productPreferencesService';
import { ProductSearchService } from '../../modules/product/productSearchService';
import { ProductService } from '../../modules/product/productService';
import { ExploreService } from '../../modules/explore/exploreService';
import { CartService } from '../../modules/cart/cartService';
import { AnthropicService } from '../../core/anthropic/anthropicService';
import { BillingService } from '../../modules/billing/billingService';
import { CohereService } from '../../core/cohere/cohereService';
import { VoyageService } from '../../core/voyage/voyageService';
import { SparseService } from '../../core/sparse/sparseService';
import { OrderManagementService } from '../../modules/orderManagement/orderManagementsService';
import { NotificationsService } from '../../modules/notifications/notificationsService';
import { SlackService } from '../../modules/slack/slackService';
import { MockService } from '../../modules/mock/mockService';
import { EmailService } from '../../core/email/emailService';
import { RedisService } from '../../core/redis/redisService';
import { ProductScraperService } from '../../modules/productScraper/productScraperService';
import { AdminService } from '../../modules/admin/adminService';
import { SupabaseStorageService } from '../../core/supabase/supabaseStorageService';
import { PinterestService } from '../../modules/pinterest/pinterestService';
import { ImagePreferenceService } from '../../modules/explore/imagePreferencesService';
import { ImageDownloaderService } from '../../core/imageDownloader/imageDownloaderService';
import { ProductImageService } from '../../core/productImage/productImageService';
import { Perf } from '../../core/performance/performance';
import { ShipmentTrackingService } from '../../modules/shipping/shipmentTrackingService';
import { BrexService } from '../../core/brex/brexService';
import { ShippingEmailService } from '../../modules/shipping/shippingEmailService';
import { OrderAutomationService } from '../../modules/orderAutomation/orderAutomationService';
import { GroqService } from '../../core/groq/groqService';
import { CommentingService } from '../../modules/commenting/commentingService';
import { StylePickerProductService } from '../../modules/product/stylePickerProductService';
import { DiscoveryService } from '../../modules/discovery/discoveryService';

export class ServiceContainer {
  private static instance: ServiceContainer;
  private container: Container;

  private constructor() {
    this.container = new Container({
      defaultScope: 'Singleton',
    });
    this.registerServices();
  }

  private registerServices(): void {
    // Core services
    this.container.bind<LogService>(LogService).toSelf();
    this.container.bind<S3Service>(S3Service).toSelf();
    this.container.bind<SupabaseStorageService>(SupabaseStorageService).toSelf();
    this.container.bind<UserService>(UserService).toSelf();
    this.container.bind<OpenAIService>(OpenAIService).toSelf();
    this.container.bind<SiglipService>(SiglipService).toSelf();
    this.container.bind<EmbeddingsService>(EmbeddingsService).toSelf();
    this.container.bind<PineconeService>(PineconeService).toSelf();
    this.container.bind<ExploreRequestService>(ExploreRequestService).toSelf();
    this.container.bind<ProductPreferenceService>(ProductPreferenceService).toSelf();
    this.container.bind<ProductService>(ProductService).toSelf();
    this.container.bind<ProductSearchService>(ProductSearchService).toSelf();
    this.container.bind<ExploreService>(ExploreService).toSelf();
    this.container.bind<CartService>(CartService).toSelf();
    this.container.bind<AnthropicService>(AnthropicService).toSelf();
    this.container.bind<BillingService>(BillingService).toSelf();
    this.container.bind<CohereService>(CohereService).toSelf();
    this.container.bind<VoyageService>(VoyageService).toSelf();
    this.container.bind<SparseService>(SparseService).toSelf();
    this.container.bind<OrderManagementService>(OrderManagementService).toSelf();
    this.container.bind<NotificationsService>(NotificationsService).toSelf();
    this.container.bind<SlackService>(SlackService).toSelf();
    this.container.bind<MockService>(MockService).toSelf();
    this.container.bind<DiscoveryService>(DiscoveryService).toSelf();
    this.container.bind<EmailService>(EmailService).toSelf();
    this.container.bind<RedisService>(RedisService).toSelf();
    this.container.bind<ProductScraperService>(ProductScraperService).toSelf();
    this.container.bind<AdminService>(AdminService).toSelf().inSingletonScope();
    this.container.bind<PinterestService>(PinterestService).toSelf();
    this.container.bind<ImagePreferenceService>(ImagePreferenceService).toSelf();
    this.container.bind<ImageDownloaderService>(ImageDownloaderService).toSelf();
    this.container.bind<ProductImageService>(ProductImageService).toSelf();
    this.container.bind<ShipmentTrackingService>(ShipmentTrackingService).toSelf();
    this.container.bind<ShippingEmailService>(ShippingEmailService).toSelf();
    // this.container.bind<DDTraceService>(DDTraceService).toSelf();
    this.container.bind<Perf>(Perf).toSelf();
    this.container.bind<BrexService>(BrexService).toSelf().inSingletonScope();
    this.container.bind<OrderAutomationService>(OrderAutomationService).toSelf();
    this.container.bind<GroqService>(GroqService).toSelf();
    this.container.bind<CommentingService>(CommentingService).toSelf();
    this.container.bind<StylePickerProductService>(StylePickerProductService).toSelf();
  }

  public static getInstance(): ServiceContainer {
    if (!ServiceContainer.instance) {
      ServiceContainer.instance = new ServiceContainer();
    }
    return ServiceContainer.instance;
  }

  public getService<T>(serviceIdentifier: { new (...args: unknown[]): T }): T {
    return this.container.get<T>(serviceIdentifier);
  }
}

// Export a convenient way to get services
export function getService<T>(serviceIdentifier: { new (...args: unknown[]): T }): T {
  return ServiceContainer.getInstance().getService(serviceIdentifier);
}
