import { Product } from '@fetchr/schema/base/base';
import { BaseService } from '../../base/service_injection/baseService';
import { inject, injectable } from 'inversify';
import { ProductService } from '../product/productService';
import { supabaseDb } from '../../base/database/supabaseDb';
import { getRequestUser } from '../../base/logging/requestContext';
import {
  ContinueDiscoverySessionRequest,
  ContinueDiscoverySessionResponse,
  GetDiscoveryProductsRequest,
  BookmarkProductRequest,
  BookmarkProductResponse,
  StartDiscoverySessionRequest,
  StartDiscoverySessionResponse,
  GetBookmarkedProductIdsRequest,
  GetBookmarkedProductIdsResponse,
  UnbookmarkProductRequest,
  UnbookmarkProductResponse,
  ListBookmarkedProductsResponse,
  ListBookmarkedProductsRequest,
} from '@fetchr/schema/discovery/discovery';
import { convertCategoryToDbCategory, convertGenderToDbGender } from '../../../shared/converters';
import { Perf } from '../../core/performance/performance';
import { ProductSearchService } from '../product/productSearchService';
import { OpenAIService } from '../../core/open_ai/openaiService';
import { AnthropicService } from '../../core/anthropic/anthropicService';
import { DiscoveryAgent } from '../../core/agent/looped_agent/discovery/DiscoveryAgent';
import {
  FindProductsRequestPayload,
  FindProductsResponsePayload,
} from '../../core/chat/tools/discovery/find_products_tool';
import {
  DISCOVERY_AGENT_PROMPT_CONTINUE,
  DISCOVERY_AGENT_PROMPT_CONTINUE_WITH_PRODUCT,
  DISCOVERY_AGENT_PROMPT_BOOKMARKS,
} from './discoveryPrompts';
import {
  PresentProductsRequestPayload,
  PresentProductsResponsePayload,
} from '../../core/chat/tools/discovery/present_products_tool';
import { FetchrMessage } from '../../core/chat/chatHistory';

@injectable()
export class DiscoveryService extends BaseService {
  constructor(
    @inject(ProductService) private productService: ProductService,
    @inject(ProductSearchService) private productSearchService: ProductSearchService,
    @inject(Perf) private perfService: Perf,
    @inject(OpenAIService) private openAIService: OpenAIService,
    @inject(AnthropicService) private anthropicService: AnthropicService,
  ) {
    super('DiscoveryService');
  }

  async getDiscoveryProducts(request: GetDiscoveryProductsRequest): Promise<Product[]> {
    const user = getRequestUser();
    if (!user) {
      throw new Error('User not found');
    }

    if (!user.metadata?.gender) {
      throw new Error('User gender not found');
    }

    // Type guard to ensure TypeScript knows these values exist
    const userGender = user.metadata.gender;
    const { lastProductId, category } = request;

    return this.perfService.track(
      'DiscoveryService.getDiscoveryProducts',
      async () => {
        // Generate a random UUID to use as a starting point
        const randomUUID = crypto.randomUUID();

        // Sample 30 random products from a random point in the UUID space
        const products = await supabaseDb.products_clean.findMany({
          take: 30,
          where: {
            gender: convertGenderToDbGender(userGender),
            is_for_kids: false,
            category: category
              ? convertCategoryToDbCategory(category)
              : {
                  in: ['TOPS', 'BOTTOMS'],
                },
            id: {
              gt: lastProductId || randomUUID, // Start from the random UUID
            },
          },
          orderBy: {
            id: 'asc', // Order by UUID
          },
        });

        return Promise.all(
          products.map(product => this.productService.convertDbProductToProduct(product)),
        );
      },
      {
        userId: user.id,
        lastProductId,
        category,
        hasCategory: !!category,
        productCount: 30,
      },
    );
  }

  async startDiscoverySession(
    request: StartDiscoverySessionRequest,
  ): Promise<StartDiscoverySessionResponse> {
    const user = getRequestUser();
    if (!user) {
      throw new Error('User not found');
    }

    const chatId = crypto.randomUUID();
    await supabaseDb.discovery_sessions.create({
      data: {
        id: chatId,
        user_id: user.id,
      },
    });

    const response = await this.processDiscoveryMessage({
      chatId,
      productId: request.productId,
      message: request.query,
    });

    return {
      products: response.products,
      chatId: chatId,
      suggestedSearches: response.suggestedSearches,
      response: response.response,
      category: response.category,
    };
  }

  async continueDiscoverySession(
    request: ContinueDiscoverySessionRequest,
  ): Promise<ContinueDiscoverySessionResponse> {
    const user = getRequestUser();
    if (!user) {
      throw new Error('User not found');
    }

    return this.processDiscoveryMessage({
      chatId: request.chatId,
      productId: request.productId,
      message: request.message,
    });
  }

  formatProductForAgent(product: Product): string {
    return `# Product: ${product?.name} - ${product?.brandName} ${
      product?.subBrandName ? `(${product?.subBrandName})` : ''
    }
Id: ${product?.id}
${product?.generatedDescription}
Details: ${product?.details}
Colors: ${product?.colors?.join(', ')}
Materials: ${product?.materials?.join(', ')}
`;
  }

  async processDiscoveryMessage(message: {
    chatId: string;
    productId?: string;
    message?: string;
  }): Promise<{
    products: Product[];
    suggestedSearches: string[];
    response: string;
    category: string;
  }> {
    const user = getRequestUser();
    if (!user) {
      throw new Error('User not found');
    }

    const agent = new DiscoveryAgent({
      chatId: message.chatId,
      maxSteps: 5,
      userProfile: user,
    });

    await agent.init();

    if (!message.message) {
      throw new Error('Message is required');
    }

    if (agent.chatHistory.messages.length > 2) {
      const bookmarks = await supabaseDb.bookmarks.findMany({
        where: {
          chat_id: message.chatId,
        },
      });

      const bookmarkIds = bookmarks.map(bookmark => bookmark.product_id);

      const lastMessage = agent.chatHistory.messages[agent.chatHistory.messages.length - 2];
      if (lastMessage.role !== 'assistant' || !Array.isArray(lastMessage.content)) {
        throw new Error('Last message is not a assistant message');
      }

      const lastMessageContent = lastMessage.content[0];
      if (
        lastMessageContent.type !== 'tool_use' ||
        lastMessageContent.payload.fetchrLLMToolType !== 'present_products'
      ) {
        throw new Error('Last message is not a present products message');
      }

      const lastMessagePayload = lastMessageContent.payload as PresentProductsRequestPayload;

      const bookmarkedProducts = this._getPresentedProducts(
        agent.chatHistory.messages,
        lastMessagePayload.ids,
      ).filter(product => bookmarkIds.includes(product.id));

      agent.addMessage({
        role: 'user',
        content: DISCOVERY_AGENT_PROMPT_BOOKMARKS.replace(
          '{bookmarks}',
          bookmarkedProducts.map(product => this.formatProductForAgent(product)).join('\n'),
        ),
      });
    }

    agent.addMessage({
      role: 'user',
      content: DISCOVERY_AGENT_PROMPT_CONTINUE.replace('{message}', message.message),
    });

    if (message.productId) {
      const product = await this.productService.getProduct(message.productId);
      if (!product) {
        throw new Error('Product not found');
      }
      agent.addMessage({
        role: 'user',
        content: DISCOVERY_AGENT_PROMPT_CONTINUE_WITH_PRODUCT.replace(
          '{product}',
          this.formatProductForAgent(product),
        ),
      });
    }

    const response: {
      products: Product[];
      suggestedSearches: string[];
      response: string;
      category: string;
    } = {
      products: [],
      suggestedSearches: [],
      response: '',
      category: '',
    };

    try {
      const agentGenerator = agent.run();
      for await (const responseChunk of agentGenerator) {
        this.logService.info('Yielding Process Message Response Chunk', {
          metadata: { responseChunk },
        });
        const type = responseChunk.type;
        switch (type) {
          case 'status': {
            this.logService.info('Yielding status update', {
              metadata: { status: responseChunk.status },
            });
            break;
          }
          case 'pending_tool_usage': {
            const pendingToolUse = responseChunk.request;
            if (!pendingToolUse) {
              this.logService.error('No pending tool use found');
              throw new Error('No pending tool use found');
            }
            this.logService.info('Pending tool use', {
              metadata: { pendingToolUse },
            });
            switch (pendingToolUse.payload.fetchrLLMToolType) {
              case 'find_products': {
                const payload = pendingToolUse.payload as FindProductsRequestPayload;

                // Execute searches for all queries in parallel
                const searchPromises = payload.searchQueries.map(async searchQuery => {
                  const products = await this.productSearchService.searchProducts({
                    query: searchQuery,
                    brandIds: [],
                    productIdWhitelist: [],
                    productIdBlacklist: [],
                    gender: user.metadata?.gender,
                    topK: 6,
                  });

                  const productsWithoutKids = products
                    .map(product => product.product)
                    .filter(product => product !== undefined && !product.isKidProduct) as Product[];

                  return {
                    id: crypto.randomUUID(),
                    query: searchQuery,
                    products: productsWithoutKids,
                  };
                });

                const queryResults = await Promise.all(searchPromises);

                agent.addToolUsageResult(
                  new FindProductsResponsePayload({
                    queryResults: queryResults,
                  }),
                  pendingToolUse.id,
                );
                break;
              }
              case 'present_products': {
                const payload = pendingToolUse.payload as PresentProductsRequestPayload;
                const presentedProducts = this._getPresentedProducts(
                  agent.chatHistory.messages,
                  payload.ids,
                );

                response.products.push(...presentedProducts);
                response.suggestedSearches.push(...payload.suggested_searches);
                response.response = payload.response;
                response.category = payload.category;

                this.logService.info('Presenting products', {
                  metadata: { products: response.products, chosenIds: payload.ids },
                });
                agent.addToolUsageResult(new PresentProductsResponsePayload(), pendingToolUse.id);
                break;
              }
              default: {
                this.logService.error('Unknown tool type', {
                  metadata: { toolType: pendingToolUse.payload.fetchrLLMToolType },
                });
                break;
              }
            }
            break;
          }
          case 'complete': {
            this.logService.info('Agent complete', {
              metadata: { responseChunk },
            });
            break;
          }
        }
      }
    } catch (error) {
      this.logService.error('Error in agent', {
        metadata: { error },
      });
      throw error;
    } finally {
      this.logService.info('Agent complete');
    }

    if (response.products.length === 0) {
      this.logService.info('Agent did not suggest any products');
      throw new Error('Agent did not suggest any products');
    }

    return response;
  }

  async bookmarkProduct(request: BookmarkProductRequest): Promise<BookmarkProductResponse> {
    const user = getRequestUser();
    if (!user) {
      throw new Error('User not found');
    }

    await supabaseDb.bookmarks.create({
      data: {
        product_id: request.productId,
        chat_id: request.chatId,
        user_id: user.id,
      },
    });

    return {};
  }

  async getBookmarkedProductIds(
    request: GetBookmarkedProductIdsRequest,
  ): Promise<GetBookmarkedProductIdsResponse> {
    const user = getRequestUser();
    if (!user) {
      throw new Error('User not found');
    }

    const bookmarks = await supabaseDb.bookmarks.findMany({
      where: {
        chat_id: request.chatId,
      },
    });

    return {
      productIds: bookmarks.map(bookmark => bookmark.product_id),
    };
  }

  async unbookmarkProduct(request: UnbookmarkProductRequest): Promise<UnbookmarkProductResponse> {
    const user = getRequestUser();
    if (!user) {
      throw new Error('User not found');
    }
    if (request.chatId) {
      await supabaseDb.bookmarks.delete({
        where: {
          user_id_product_id_chat_id: {
            user_id: user.id,
            product_id: request.productId,
            chat_id: request.chatId ?? '',
          },
        },
      });
    } else {
      // prisma doesn't recognize partial indexes, so we need to delete many instead of delete
      await supabaseDb.bookmarks.deleteMany({
        where: {
          user_id: user.id,
          product_id: request.productId,
        },
      });
    }
    return {};
  }

  async listBookmarkedProducts(
    request: ListBookmarkedProductsRequest,
  ): Promise<ListBookmarkedProductsResponse> {
    const user = getRequestUser();
    if (!user) {
      throw new Error('User not found');
    }

    const bookmarks = await supabaseDb.bookmarks.findMany({
      where: {
        user_id: user.id,
        ...(request.lastCreatedAt && {
          created_at: {
            lt: request.lastCreatedAt,
          },
        }),
      },
      orderBy: {
        created_at: 'desc',
      },
      take: 30,
    });

    const products = await this.productService.getProductsByIds(
      bookmarks.map(bookmark => bookmark.product_id),
    );

    return {
      products: products,
    };
  }

  private _getPresentedProducts(messages: FetchrMessage[], chosenIds: string[]): Product[] {
    const products: Product[] = [];
    for (const message of messages) {
      if (message.role !== 'user' || !Array.isArray(message.content)) {
        continue;
      }
      for (const block of message.content) {
        if (block.type === 'tool_result' && block.payload.fetchrLLMToolType === 'find_products') {
          const payload = block.payload as FindProductsResponsePayload;
          products.push(
            ...payload.queryResults
              .filter(queryResult => chosenIds.includes(queryResult.id))
              .flatMap(result => result.products),
          );
        }
      }
    }
    return products;
  }
}
