/* eslint-disable @typescript-eslint/no-non-null-assertion */
const isDevelopment = process.env.NODE_ENV === 'development';

export const stripeConfigs = {
  publishableKey: isDevelopment
    ? process.env.STRIPE_TEST_PUBLISHABLE_KEY!
    : process.env.STRIPE_PUBLISHABLE_KEY!,
  secretKey: isDevelopment ? process.env.STRIPE_TEST_SECRET_KEY! : process.env.STRIPE_SECRET_KEY!,
  webhookSecret: isDevelopment
    ? process.env.STRIPE_WEBHOOK_SECRET_DEV!
    : process.env.STRIPE_WEBHOOK_SECRET!,
};
