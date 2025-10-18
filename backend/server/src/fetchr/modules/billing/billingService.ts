import { inject, injectable } from 'inversify';
import { BaseService } from '../../base/service_injection/baseService';
import Stripe from 'stripe';
import { supabaseDb } from '../../base/database/supabaseDb';
import { SubscriptionData, GetStripeConfigResponse } from '@fetchr/schema/billing/billing';
import { MembershipType } from '@fetchr/schema/base/base';
import { getRequestUser } from '../../base/logging/requestContext';
import { order_type } from '@prisma/client';
import { getOrderSuggestionDates } from '../../base/orderUtils/orderDates';
import { isAppStoreReviewerEmail } from '../../../shared/appStoreReview';
import {
  PaymentMethodStatus,
  StripeSubscription,
  SubscriptionCadence,
} from '@fetchr/schema/base/user_billing';
import { RedisService } from '../../core/redis/redisService';

const GLOBAL_FORCE_MODE: undefined | 'test' | 'live' = undefined;

@injectable()
export class BillingService extends BaseService {
  constructor(@inject(RedisService) private redisService: RedisService) {
    super('BillingService');
  }

  /**
   * Return a Stripe instance based on the selected mode.
   */
  public getStripeInstance(forceMode?: 'test' | 'live'): Stripe {
    const mode = GLOBAL_FORCE_MODE ?? forceMode ?? this.getModeForRequest();
    console.log('[payment] getStripeInstance input mode:', mode);
    console.log('[payment] getStripeInstance GLOBAL_FORCE_MODE:', GLOBAL_FORCE_MODE);
    console.log('[payment] getStripeInstance forceMode:', forceMode);

    const secretKey =
      mode === 'test' ? process.env.STRIPE_SECRET_KEY_TEST : process.env.STRIPE_SECRET_KEY_LIVE;

    if (!secretKey) {
      throw new Error(
        `Stripe secret key not found for mode "${mode}". Check your environment variables.`,
      );
    }

    // Log a redacted version of the key to see if it's test or live
    console.log('[payment] Using stripe key type:', secretKey);

    return new Stripe(secretKey);
  }

  private getModeForRequest(forceMode?: 'test' | 'live', userEmail?: string): 'test' | 'live' {
    const checkUserEmail = userEmail ?? getRequestUser()?.email;
    if (
      checkUserEmail &&
      (isAppStoreReviewerEmail(checkUserEmail) || checkUserEmail.includes('shubhtest'))
    ) {
      return 'test';
    }

    if (GLOBAL_FORCE_MODE) {
      return GLOBAL_FORCE_MODE;
    }

    if (forceMode) {
      return forceMode;
    }

    return 'live';
  }

  public async deleteCustomerWithEmail(email: string): Promise<void> {
    this.logService.info(`Starting deletion of customers with email ${email}`, {
      metadata: { email },
    });

    const stripe = this.getStripeInstance('live');
    let hasMore = true;
    let totalDeleted = 0;

    try {
      while (hasMore) {
        const customers = await stripe.customers.list({
          email,
          limit: 20,
        });

        if (customers.data.length > 0) {
          this.logService.info(`Found ${customers.data.length} customers to delete`, {
            metadata: { email, customerCount: customers.data.length },
          });

          await Promise.all(
            customers.data.map(customer => {
              this.logService.info(`Deleting customer`, {
                metadata: { customerId: customer.id, email },
              });
              return stripe.customers.del(customer.id);
            }),
          );

          totalDeleted += customers.data.length;
        }

        hasMore = customers.data.length === 20;
      }

      this.logService.info(`Successfully deleted all customers with email ${email}`, {
        metadata: { email, totalDeleted },
      });
    } catch (error) {
      this.logService.error(`Error deleting customers with email ${email}`, {
        metadata: { email },
        error,
      });
      throw error;
    }
  }

  async getStripeSubscription(userId: string): Promise<StripeSubscription | null> {
    // Check cache first
    const cacheConfig = {
      ttl: 300, // 5 minutes
      prefix: 'billing',
    };

    const cacheKey = `stripe_subscription_${userId}`;
    const cached = await this.redisService.get<StripeSubscription | null>(cacheKey, cacheConfig);
    if (cached !== undefined) {
      return cached;
    }

    const dbUser = await supabaseDb.public_users.findUnique({
      where: { id: userId },
    });

    if (!dbUser) {
      throw new Error('User not found');
    }

    const customer = await this.getOrCreateCustomer(userId, dbUser.stripe_customer_id ?? undefined);
    if ('deleted' in customer) {
      throw new Error('Customer has been deleted');
    }

    const stripe = this.getStripeInstance();
    const subscription = await stripe.subscriptions.list({
      customer: customer.id,
      limit: 1,
    });

    const nonExpiredSubscriptions = subscription.data.filter(
      s => s.current_period_end && s.current_period_end > Date.now() / 1000,
    );

    if (nonExpiredSubscriptions.length === 0) {
      return null;
    }

    const result = {
      subscriptionId: nonExpiredSubscriptions[0].id,
      customerId: customer.id,
      details: {
        cadence: SubscriptionCadence.SUBSCRIPTION_CADENCE_MONTHLY,
        expirationDate: nonExpiredSubscriptions[0].current_period_end,
      },
    };

    // Cache with 5-10 minute TTL
    await this.redisService.set(cacheKey, result, cacheConfig);
    return result;
  }

  async getOrCreateCustomer(
    userId: string,
    customerId?: string,
    forceMode?: 'test' | 'live',
  ): Promise<Stripe.Customer | Stripe.DeletedCustomer> {
    const mode = this.getModeForRequest(forceMode);
    const stripe = this.getStripeInstance(mode);
    let attemptedTestMode = false; // Flag to prevent infinite retry loops

    try {
      const existingCustomer = await supabaseDb.subscriptions.findUnique({
        where: { user_id: userId },
      });

      console.log('[payment] getOrCreateCustomer Mode:', mode);

      const allCustomers: (Stripe.Customer | Stripe.DeletedCustomer)[] = [];

      // Try to retrieve existing customer if we have an ID
      const availableCustomerIds = [
        customerId,
        existingCustomer?.stripe_customer_id_test,
        existingCustomer?.stripe_customer_id_live,
      ];
      for (const custId of availableCustomerIds) {
        if (custId) {
          try {
            // Always try to retrieve with the current stripe instance
            const customer = await stripe.customers.retrieve(custId);
            allCustomers.push(customer);
          } catch (retrieveError: unknown) {
            // If we're in live mode and the error indicates a test mode customer exists,
            // log this but continue trying other IDs
            if (
              retrieveError instanceof Error &&
              retrieveError.message?.includes('a similar object exists in test mode') &&
              mode === 'live'
            ) {
              this.logService.warn(
                `Customer ID ${custId} exists in test mode but we're in live mode`,
                { metadata: { userId, customerId: custId } },
              );
              // Don't throw here, just continue checking other IDs
            }
          }
        }
      }

      // Find first non-deleted customer with subscription or payment method
      const customerWithSubscription = allCustomers.find(
        c =>
          !('deleted' in c) &&
          'subscriptions' in c &&
          c.subscriptions?.data?.length &&
          c.subscriptions.data.length > 0,
      );
      if (customerWithSubscription) {
        return customerWithSubscription;
      }

      const customerWithPaymentMethod = allCustomers.find(
        c => !('deleted' in c) && 'default_source' in c && c.default_source,
      );

      if (customerWithPaymentMethod) {
        return customerWithPaymentMethod;
      }

      // Fall back to first non-deleted customer if none have subscription/payment
      const customer = allCustomers.find(c => !('deleted' in c));
      if (customer) {
        return customer;
      }

      // Customer doesn't exist or was deleted - create new one
      const userData = await supabaseDb.public_users.findUnique({
        where: { id: userId },
      });

      if (!userData) {
        throw new Error(`User ${userId} not found`);
      }

      const newCustomer = await stripe.customers.create({
        email: userData.email ?? undefined,
        name: `${userData.first_name} ${userData.last_name}`.trim(),
        metadata: {
          userId: userId,
        },
      });

      if (!existingCustomer) {
        await Promise.all([
          supabaseDb.subscriptions.create({
            data: {
              user_id: userId,
              stripe_customer_id_live: mode === 'live' ? newCustomer.id : null,
              stripe_customer_id_test: mode === 'test' ? newCustomer.id : null,
              email: userData.email,
            },
          }),
          supabaseDb.public_users.update({
            where: { id: userId },
            data: {
              stripe_customer_id: newCustomer.id,
            },
          }),
        ]);
      } else {
        await Promise.all([
          supabaseDb.subscriptions.update({
            where: { user_id: userId },
            data: {
              stripe_customer_id_live:
                mode === 'live' ? newCustomer.id : existingCustomer.stripe_customer_id_live,
              stripe_customer_id_test:
                mode === 'test' ? newCustomer.id : existingCustomer.stripe_customer_id_test,
              email: userData.email,
            },
          }),
          supabaseDb.public_users.update({
            where: { id: userId },
            data: {
              stripe_customer_id: newCustomer.id,
            },
          }),
        ]);
      }

      return newCustomer;
    } catch (error: unknown) {
      // Handle the specific error case when a customer exists in test mode
      // but we're trying to access it with a live mode key
      if (error instanceof Error) {
        const errorMessage = error.message || '';
        if (
          mode === 'live' &&
          !attemptedTestMode &&
          errorMessage.includes('a similar object exists in test mode')
        ) {
          this.logService.warn(
            `Live mode operation failed for user ${userId}, retrying in test mode`,
            { metadata: { userId, originalError: errorMessage } },
          );
          attemptedTestMode = true;
          return this.getOrCreateCustomer(userId, customerId, 'test'); // Retry in test mode
        }

        this.logService.error(`Error in getOrCreateCustomer for user ${userId}`, {
          metadata: { userId, mode },
          error,
        });
        throw error;
      } else {
        // Handle case where error is not an Error instance
        this.logService.error(`Unknown error in getOrCreateCustomer for user ${userId}`, {
          metadata: { userId, mode },
        });
        throw new Error(`Unknown error in getOrCreateCustomer for user ${userId}`);
      }
    }
  }

  async getUserMembershipType(userId: string): Promise<MembershipType> {
    const stripe = this.getStripeInstance();
    try {
      const subscription = await supabaseDb.subscriptions.findUnique({
        where: { user_id: userId },
      });

      if (!subscription?.stripe_subscription_id) {
        return MembershipType.MEMBERSHIP_TYPE_FREE;
      }

      const stripeSubscription = await stripe.subscriptions.retrieve(
        subscription.stripe_subscription_id,
      );

      return stripeSubscription.status === 'active'
        ? MembershipType.MEMBERSHIP_TYPE_PRO
        : MembershipType.MEMBERSHIP_TYPE_FREE;
    } catch (error) {
      this.logService.error(`Error getting membership type for user ${userId}`, {
        metadata: { userId },
        error,
      });
      return MembershipType.MEMBERSHIP_TYPE_FREE;
    }
  }

  async createCheckoutSession(
    userId: string,
    amount: number,
    isOneTime: boolean = false,
    successUrl: string,
    cancelUrl: string,
    mode: 'redirect' | 'embedded' = 'redirect',
  ): Promise<{ url: string; clientSecret?: string }> {
    const stripe = this.getStripeInstance();
    try {
      const customerId = await this.getOrCreateCustomer(userId);

      const sessionConfig: Stripe.Checkout.SessionCreateParams = {
        customer: customerId.id,
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: isOneTime ? 'One-time Purchase' : 'Monthly Subscription',
                description: 'Fetchr Personal Shopping Service',
              },
              unit_amount: amount,
              ...(isOneTime ? {} : { recurring: { interval: 'month' } }),
            },
            quantity: 1,
          },
        ],
        mode: isOneTime ? 'payment' : 'subscription',
        ...(mode === 'embedded'
          ? { ui_mode: 'embedded', return_url: successUrl }
          : { success_url: successUrl, cancel_url: cancelUrl }),
      };

      const session = await stripe.checkout.sessions.create(sessionConfig);

      return {
        url: session.url ?? '',
        clientSecret: mode === 'embedded' ? session.client_secret ?? undefined : undefined,
      };
    } catch (error) {
      this.logService.error(`Error creating checkout session for user ${userId}`, {
        metadata: { userId, amount, isOneTime },
        error,
      });
      throw error;
    }
  }

  async syncStripeDataToDB(stripeCustomerId: string): Promise<SubscriptionData> {
    // First determine if this is a test or live customer ID
    const testCustomer = await supabaseDb.subscriptions.findFirst({
      where: { stripe_customer_id_test: stripeCustomerId },
    });
    const mode = testCustomer ? 'test' : 'live';

    const stripe = this.getStripeInstance(mode);
    try {
      const subscriptions = await stripe.subscriptions.list({
        customer: stripeCustomerId,
        limit: 1,
        status: 'all',
        expand: ['data.default_payment_method'],
      });

      const customer = await stripe.customers.retrieve(stripeCustomerId);

      if ('deleted' in customer) {
        throw new Error('Customer has been deleted');
      }

      const userId = customer.metadata.userId;
      const subscription = subscriptions.data[0];
      const paymentMethod = subscription?.default_payment_method as Stripe.PaymentMethod;

      const mappedStatus = !subscription?.status
        ? 'none'
        : [
            'incomplete',
            'incomplete_expired',
            'trialing',
            'active',
            'past_due',
            'canceled',
            'unpaid',
            'paused',
          ].includes(subscription.status)
        ? subscription.status
        : 'none';

      this.logService.info('Syncing subscription status:', {
        metadata: {
          originalStatus: subscription?.status,
          mappedStatus,
          subscriptionId: subscription?.id,
          subscription,
        },
      });

      const updatedSubscription = await supabaseDb.subscriptions.update({
        where: {
          user_id: userId,
        },
        data: {
          subscription_status: mappedStatus,
          stripe_subscription_id: subscription?.id,
          current_period_start: subscription?.current_period_start
            ? new Date(subscription.current_period_start * 1000)
            : null,
          current_period_end: subscription?.current_period_end
            ? new Date(subscription.current_period_end * 1000)
            : null,
          cancel_at_period_end: subscription?.cancel_at_period_end ?? false,
          payment_method_brand: paymentMethod?.card?.brand ?? null,
          payment_method_last4: paymentMethod?.card?.last4 ?? null,
          price_id: subscription?.items.data[0]?.price.id ?? null,
        },
      });

      // await this.userService.clearUserCache(userId);

      return {
        status: updatedSubscription.subscription_status ?? 'none',
        currentPeriodStart: updatedSubscription.current_period_start?.getTime() ?? undefined,
        currentPeriodEnd: updatedSubscription.current_period_end?.getTime() ?? undefined,
        subscriptionId: updatedSubscription.stripe_subscription_id ?? undefined,
        priceId: updatedSubscription.price_id ?? undefined,
        cancelAtPeriodEnd: updatedSubscription.cancel_at_period_end ?? undefined,
        paymentMethod: paymentMethod?.card
          ? {
              brand: paymentMethod.card.brand,
              last4: paymentMethod.card.last4 ?? '',
            }
          : undefined,
      };
    } catch (error) {
      this.logService.error(`Error syncing Stripe data for customer ${stripeCustomerId}`, {
        metadata: { stripeCustomerId, mode },
        error,
      });
      throw error;
    }
  }

  async cancelSubscription(userId: string): Promise<void> {
    const stripe = this.getStripeInstance();
    const mode = this.getModeForRequest();
    try {
      const customerData = await supabaseDb.subscriptions.findUnique({
        where: { user_id: userId },
      });

      if (!customerData?.stripe_subscription_id) {
        throw new Error(`No active subscription found for user ${userId}`);
      }

      await stripe.subscriptions.cancel(customerData.stripe_subscription_id);

      if (mode === 'live' && customerData.stripe_customer_id_live) {
        await this.syncStripeDataToDB(customerData.stripe_customer_id_live);
      } else if (mode === 'test' && customerData.stripe_customer_id_test) {
        await this.syncStripeDataToDB(customerData.stripe_customer_id_test);
      }
    } catch (error) {
      this.logService.error(`Error canceling subscription for user ${userId}`, {
        metadata: { userId },
        error,
      });
      throw error;
    }
  }

  async getStripeConfigs(isDevModeApp: boolean): Promise<GetStripeConfigResponse> {
    const mode = this.getModeForRequest(isDevModeApp ? 'test' : 'live');
    if (!process.env.STRIPE_PUBLISHABLE_KEY_TEST || !process.env.STRIPE_MERCHANT_ID) {
      throw new Error('Stripe configs not found');
    }

    if (mode === 'test') {
      if (
        !process.env.STRIPE_PUBLISHABLE_KEY_TEST ||
        !process.env.STRIPE_MERCHANT_ID ||
        !process.env.STRIPE_SUBSCRIPTION_PRICE_ID_TEST
      ) {
        throw new Error('Stripe configs not found');
      }
      return {
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY_TEST,
        merchantId: process.env.STRIPE_MERCHANT_ID,
        subscriptionPriceId: process.env.STRIPE_SUBSCRIPTION_PRICE_ID_TEST,
      };
    } else {
      if (
        !process.env.STRIPE_PUBLISHABLE_KEY_LIVE ||
        !process.env.STRIPE_MERCHANT_ID ||
        !process.env.STRIPE_SUBSCRIPTION_PRICE_ID_LIVE
      ) {
        throw new Error('Stripe configs not found');
      }
      return {
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY_LIVE,
        merchantId: process.env.STRIPE_MERCHANT_ID,
        subscriptionPriceId: process.env.STRIPE_SUBSCRIPTION_PRICE_ID_LIVE,
      };
    }
  }

  async createPaymentIntent(
    userId: string,
    amount: number,
    isSubscription: boolean = true,
    forceMode: 'test' | 'live' = 'live',
  ): Promise<{ clientSecret: string; ephemeralKey: string; customerId: string }> {
    const mode = this.getModeForRequest(forceMode);
    const stripe = this.getStripeInstance(mode);
    try {
      const customer = await this.getOrCreateCustomer(userId, undefined, mode);

      if ('deleted' in customer) {
        throw new Error('Customer has been deleted');
      }

      const ephemeralKey = await stripe.ephemeralKeys.create({ customer: customer.id });

      const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency: 'usd',
        customer: customer.id,
        setup_future_usage: isSubscription ? 'off_session' : undefined,
        automatic_payment_methods: {
          enabled: true,
        },
      });

      if (!paymentIntent.client_secret || !ephemeralKey.secret) {
        this.logService.error('Failed to create payment intent or ephemeral key', {
          metadata: { userId, amount },
        });
        throw new Error('Failed to create payment intent or ephemeral key');
      }

      return {
        clientSecret: paymentIntent.client_secret,
        ephemeralKey: ephemeralKey.secret,
        customerId: customer.id,
      };
    } catch (error) {
      this.logService.error(`Error creating payment intent for user ${userId}`, {
        metadata: { userId, amount },
        error,
      });
      throw error;
    }
  }

  async createSubscription(
    userId: string,
    priceId: string,
  ): Promise<{ subscriptionId: string; clientSecret: string; customerId: string }> {
    const mode = this.getModeForRequest();
    const stripe = this.getStripeInstance(mode);
    try {
      const customer = await this.getOrCreateCustomer(userId, undefined, mode);

      if ('deleted' in customer) {
        throw new Error('Customer has been deleted');
      }

      const subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: priceId }],
        payment_behavior: 'default_incomplete',
        payment_settings: { save_default_payment_method: 'on_subscription' },
        expand: ['latest_invoice.payment_intent'],
      });

      if (
        !subscription.latest_invoice ||
        typeof subscription.latest_invoice === 'string' ||
        !subscription.latest_invoice.payment_intent ||
        typeof subscription.latest_invoice.payment_intent === 'string' ||
        !subscription.latest_invoice.payment_intent.client_secret
      ) {
        throw new Error('Failed to create subscription properly');
      }

      return {
        subscriptionId: subscription.id,
        clientSecret: subscription.latest_invoice.payment_intent.client_secret,
        customerId: customer.id,
      };
    } catch (error) {
      this.logService.error(`Error creating subscription for user ${userId}`, {
        metadata: { userId, priceId },
        error,
      });
      throw error;
    }
  }

  async chargeCustomer(
    customerId: string,
    amountInCents: number,
    userEmail?: string,
    metadata?: Record<string, string>,
    forceMode?: 'test' | 'live',
  ): Promise<string> {
    const mode = this.getModeForRequest(forceMode, userEmail);
    const stripe = this.getStripeInstance(mode);
    try {
      const customer = await stripe.customers.retrieve(customerId);

      if (customer.deleted) {
        throw new Error('Customer has been deleted');
      }

      // Get the customer's payment methods
      const paymentMethods = await stripe.paymentMethods.list({
        customer: customerId,
      });

      if (!paymentMethods.data.length) {
        throw new Error('No payment method found for customer');
      }

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountInCents,
        currency: 'usd',
        customer: customerId,
        payment_method: paymentMethods.data[0].id,
        off_session: true,
        confirm: true,
        metadata: { ...metadata, email: userEmail ?? null },
      });

      if (paymentIntent.status !== 'succeeded') {
        throw new Error('Payment failed');
      }

      return paymentIntent.id;
    } catch (error) {
      this.logService.error(`Error charging customer ${customerId}`, {
        metadata: { customerId, amountInCents, chargeMetadata: metadata, email: userEmail },
        error,
      });
      throw error;
    }
  }

  async createStripeSetupIntent(
    userId: string,
  ): Promise<{ clientSecret: string; customerId: string }> {
    const mode = this.getModeForRequest();
    console.log('[payment] createStripeSetupIntent Mode:', mode);
    const stripe = this.getStripeInstance(mode);
    try {
      const customer = await this.getOrCreateCustomer(userId, undefined, mode);

      if ('deleted' in customer) {
        throw new Error('Customer has been deleted');
      }

      const setupIntent = await stripe.setupIntents.create({
        customer: customer.id,
        payment_method_types: ['card'],
        usage: 'off_session', // This allows the payment method to be used for future payments
      });

      this.logService.info('stripe setup intent created', {
        metadata: { setupIntent },
      });

      if (!setupIntent.client_secret) {
        this.logService.error('Failed to create setup intent', {
          metadata: { userId },
        });
        throw new Error('Failed to create setup intent');
      }

      return {
        clientSecret: setupIntent.client_secret,
        customerId: customer.id,
      };
    } catch (error) {
      this.logService.error(`Error creating setup intent for user ${userId}`, {
        metadata: { userId },
        error,
      });
      throw error;
    }
  }

  async calculateTax(
    amountInCents: number,
    address: { line1: string; city: string; state: string; postal_code: string; country: string },
  ): Promise<number> {
    const stripe = this.getStripeInstance();
    try {
      const taxCalculation = await stripe.tax.calculations.create({
        currency: 'usd',
        line_items: [
          {
            amount: amountInCents,
            reference: 'order_item',
            tax_code: 'txcd_99999999',
          },
        ],
        customer_details: {
          address: {
            line1: address.line1,
            city: address.city,
            state: address.state,
            postal_code: address.postal_code,
            country: address.country,
          },
          address_source: 'shipping',
        },
      });

      return taxCalculation.tax_amount_exclusive;
    } catch (error) {
      this.logService.error('Error calculating tax', {
        metadata: { amountInCents, address },
        error,
      });
      throw error;
    }
  }

  private async updateOrderSuggestionsOnPaymentValid(userId: string): Promise<void> {
    const orderSuggestions = await supabaseDb.order_suggestion.findMany({
      where: {
        orders_v2: {
          customer_id: userId,
        },
        status: {
          in: ['Pending', 'Draft'],
        },
      },
      include: {
        orders_v2: true,
      },
    });

    for (const suggestion of orderSuggestions) {
      const isOrderFetchrInitiated = suggestion.orders_v2.type === order_type.fetchr_initiated;
      const isDraftSuggestion = suggestion.status === 'Draft';

      const dates = getOrderSuggestionDates({
        isAutoAccepted: false,
        isOrderFetchrInitiated,
        hasValidPayment: true,
        isDraftSuggestion,
      });

      await supabaseDb.order_suggestion.update({
        where: { id: suggestion.id },
        data: {
          verify_suggestions_by: dates.verifySuggestionsBy,
          expire_suggestions_by: dates.expireSuggestionsBy,
        },
      });
    }
  }

  async refreshCustomerPaymentStatus(
    userId: string,
    forceMode?: 'test' | 'live',
  ): Promise<{
    status: PaymentMethodStatus;
    paymentMethods: { brand: string; last4: string; expiryMonth: number; expiryYear: number }[];
  }> {
    let status = PaymentMethodStatus.PAYMENT_METHOD_STATUS_NO_PAYMENT_METHOD;
    let mappedPaymentMethods: {
      brand: string;
      last4: string;
      expiryMonth: number;
      expiryYear: number;
    }[] = [];

    try {
      // Get user data from database
      const userData = await supabaseDb.public_users.findUnique({
        where: { id: userId },
      });

      if (!userData) {
        throw new Error(`User ${userId} not found`);
      }

      const currentPaymentStatus = userData.payment_method_status || 'NO_PAYMENT_METHOD';
      const mode = this.getModeForRequest(forceMode, userData.email ?? undefined);

      const stripe = this.getStripeInstance(mode);

      // First check if we have a customer ID for this user
      const existingCustomer = await supabaseDb.subscriptions.findUnique({
        where: { user_id: userId },
      });

      console.log('payment status existingCustomer:', existingCustomer);
      const customerId =
        mode === 'test'
          ? existingCustomer?.stripe_customer_id_test
          : existingCustomer?.stripe_customer_id_live;

      if (customerId) {
        // Verify the customer exists and isn't deleted
        const customer = await stripe.customers.retrieve(customerId);

        if (!('deleted' in customer)) {
          // Get all payment methods for the customer
          const paymentMethods = await stripe.paymentMethods.list({
            customer: customerId,
            type: 'card',
          });

          if (paymentMethods.data.length > 0) {
            // Check if any payment method is not expired
            const now = new Date();
            const currentYear = now.getFullYear();
            const currentMonth = now.getMonth() + 1;

            const validPaymentMethods = paymentMethods.data.filter(pm => {
              if (pm.card?.exp_year && pm.card?.exp_month) {
                if (pm.card.exp_year > currentYear) {
                  return true;
                }
                if (pm.card.exp_year === currentYear && pm.card.exp_month >= currentMonth) {
                  return true;
                }
              }
              return false;
            });

            const hasValidPaymentMethod = validPaymentMethods.length > 0;
            mappedPaymentMethods = paymentMethods.data.map(pm => ({
              brand: pm.card?.brand ?? '',
              last4: pm.card?.last4 ?? '',
              expiryMonth: pm.card?.exp_month ?? 0,
              expiryYear: pm.card?.exp_year ?? 0,
            }));

            status = hasValidPaymentMethod
              ? PaymentMethodStatus.PAYMENT_METHOD_STATUS_VALID
              : PaymentMethodStatus.PAYMENT_METHOD_STATUS_EXPIRED;
          }
        }
      }

      // If transitioning to valid payment status, update order suggestions
      if (
        status === PaymentMethodStatus.PAYMENT_METHOD_STATUS_VALID &&
        currentPaymentStatus !== 'VALID'
      ) {
        await this.updateOrderSuggestionsOnPaymentValid(userId);
      }

      // Update the user's payment method status using ProfileService
      // await this.userService.updateProfile(userId, {
      //   paymentMethodStatus: status,
      //   brandsSelected: [],
      //   styleImageUrls: [],
      // });

      return {
        status,
        paymentMethods: mappedPaymentMethods,
      };
    } catch (error) {
      this.logService.error(`Error checking customer payment status for user ${userId}`, {
        metadata: { userId },
        error,
      });
      throw error;
    }
  }
}
