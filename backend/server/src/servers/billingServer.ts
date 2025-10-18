import {
  CreateCheckoutSessionRequest,
  CreateCheckoutSessionResponse,
  CancelSubscriptionRequest,
  CancelSubscriptionResponse,
  SyncStripeDataRequest,
  SyncStripeDataResponse,
  PaymentType,
  BillingServiceImplementation,
  GetOrCreateCustomerRequest,
  GetOrCreateCustomerResponse,
  CreatePaymentIntentRequest,
  CreatePaymentIntentResponse,
  CreateSubscriptionRequest,
  CreateSubscriptionResponse,
  GetStripeConfigResponse,
  GetStripeConfigRequest,
  CreateStripeSetupIntentResponse,
  CreateStripeSetupIntentRequest,
  RefreshCustomerPaymentStatusRequest,
  RefreshCustomerPaymentStatusResponse,
} from '@fetchr/schema/billing/billing';
import { billingService } from '../fetchr/base/service_injection/global';
import { convertCheckoutModeToString } from '../shared/converters';
import {
  getRequestAppStoreInformation,
  getRequestUser,
} from '../fetchr/base/logging/requestContext';
import { AppEnvironment } from '@fetchr/schema/base/base';

function getModeForEnvironment(appEnvironment: AppEnvironment): 'test' | 'live' {
  return appEnvironment === AppEnvironment.APP_ENVIRONMENT_DEV ||
    appEnvironment === AppEnvironment.APP_ENVIRONMENT_TEST_FLIGHT
    ? 'test'
    : 'live';
}

export class BillingServer implements BillingServiceImplementation {
  async createCheckoutSession(
    request: CreateCheckoutSessionRequest,
  ): Promise<CreateCheckoutSessionResponse> {
    const checkoutUrl = await billingService.createCheckoutSession(
      request.userId,
      request.amountInCents,
      request.paymentType === PaymentType.PAYMENT_TYPE_ONE_TIME,
      request.successUrl,
      request.cancelUrl,
      convertCheckoutModeToString(request.mode),
    );
    return { checkoutUrl: checkoutUrl.url, clientSecret: checkoutUrl.clientSecret };
  }

  async cancelSubscription(
    request: CancelSubscriptionRequest,
  ): Promise<CancelSubscriptionResponse> {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    request;
    const user = getRequestUser();
    if (!user) {
      throw new Error('User not found');
    }

    await billingService.cancelSubscription(user.id);
    return { success: true };
  }

  async syncStripeData(request: SyncStripeDataRequest): Promise<SyncStripeDataResponse> {
    const data = await billingService.syncStripeDataToDB(request.customerId);
    return { subscriptionData: data };
  }

  async getOrCreateCustomer(
    request: GetOrCreateCustomerRequest,
  ): Promise<GetOrCreateCustomerResponse> {
    const customerId = await billingService.getOrCreateCustomer(request.userId);
    return { customerId: customerId.id };
  }

  async refreshCustomerPaymentStatus(
    request: RefreshCustomerPaymentStatusRequest,
  ): Promise<RefreshCustomerPaymentStatusResponse> {
    const status = await billingService.refreshCustomerPaymentStatus(request.userId);
    return {
      status: status.status,
      paymentMethods: status.paymentMethods.map(paymentMethod => ({
        brand: paymentMethod.brand,
        last4: paymentMethod.last4,
        expiryMonth: paymentMethod.expiryMonth,
        expiryYear: paymentMethod.expiryYear,
      })),
    };
  }

  async createPaymentIntent(
    request: CreatePaymentIntentRequest,
  ): Promise<CreatePaymentIntentResponse> {
    const appStoreInformation = getRequestAppStoreInformation();
    if (!appStoreInformation?.appEnvironment) {
      throw new Error('App environment not found');
    }

    const mode = getModeForEnvironment(appStoreInformation.appEnvironment);

    const result = await billingService.createPaymentIntent(
      request.userId,
      request.amountInCents,
      request.paymentType === PaymentType.PAYMENT_TYPE_SUBSCRIPTION,
      mode,
    );

    return {
      clientSecret: result.clientSecret,
      ephemeralKey: result.ephemeralKey,
      customerId: result.customerId,
    };
  }

  async createSubscription(
    request: CreateSubscriptionRequest,
  ): Promise<CreateSubscriptionResponse> {
    const result = await billingService.createSubscription(request.userId, request.priceId);

    return {
      subscriptionId: result.subscriptionId,
      clientSecret: result.clientSecret,
      customerId: result.customerId,
    };
  }

  async getStripeConfig(request: GetStripeConfigRequest): Promise<GetStripeConfigResponse> {
    request;
    const appStoreInformation = getRequestAppStoreInformation();
    if (!appStoreInformation?.appEnvironment) {
      throw new Error('App environment not found');
    }

    const configs = await billingService.getStripeConfigs(
      getModeForEnvironment(appStoreInformation.appEnvironment) === 'test',
    );

    return {
      publishableKey: configs.publishableKey,
      merchantId: configs.merchantId,
      subscriptionPriceId: configs.subscriptionPriceId,
    };
  }

  async createStripeSetupIntent(
    request: CreateStripeSetupIntentRequest,
  ): Promise<CreateStripeSetupIntentResponse> {
    const appStoreInformation = getRequestAppStoreInformation();
    if (!appStoreInformation?.appEnvironment) {
      throw new Error('App environment not found');
    }

    return await billingService.createStripeSetupIntent(request.userId);
  }
}
