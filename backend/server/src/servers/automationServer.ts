import {
  AutomationServiceImplementation,
  ResolveThreadRequest,
  ResolveThreadResponse,
  RespondToThreadRequest,
  RespondToThreadResponse,
} from '@fetchr/schema/automation/automation';
import { commentingService, orderAutomationService } from '../fetchr/base/service_injection/global';
import {
  RateProductForPurchaseRequest,
  RateProductForPurchaseResponse,
  CreateThreadOnProductPurchaseSuggestionRequest,
  CreateThreadOnProductPurchaseSuggestionResponse,
} from '@fetchr/schema/automation/automation';
import { getRequestUser } from '../fetchr/base/logging/requestContext';

export class AutomationServer implements AutomationServiceImplementation {
  async rateProductForPurchase(
    request: RateProductForPurchaseRequest,
  ): Promise<RateProductForPurchaseResponse> {
    return await orderAutomationService.rateProductForPurchase(request);
  }

  async createThreadOnProductPurchaseSuggestion(
    request: CreateThreadOnProductPurchaseSuggestionRequest,
  ): Promise<CreateThreadOnProductPurchaseSuggestionResponse> {
    const requestUser = getRequestUser();
    if (!requestUser) {
      throw new Error('User not found');
    }

    return await commentingService.createThreadOnProductPurchaseSuggestion({
      ...request,
      userId: requestUser.id,
      userName:
        requestUser.name?.firstName || requestUser.name?.lastName
          ? `${requestUser.name?.firstName ?? ''} ${requestUser.name?.lastName ?? ''}`.trim()
          : 'unknown',
    });
  }

  async respondToThread(request: RespondToThreadRequest): Promise<RespondToThreadResponse> {
    const requestUser = getRequestUser();
    if (!requestUser) {
      throw new Error('User not found');
    }

    await commentingService.respondToThread({
      ...request,
      userId: requestUser.id,
      userName:
        requestUser.name?.firstName || requestUser.name?.lastName
          ? `${requestUser.name?.firstName ?? ''} ${requestUser.name?.lastName ?? ''}`.trim()
          : 'unknown',
    });

    return {};
  }

  async resolveThread(request: ResolveThreadRequest): Promise<ResolveThreadResponse> {
    await commentingService.resolveThread(request);

    return {};
  }
}

// Contextual bandwidth - Sparse data (Explicit / Implicit)
