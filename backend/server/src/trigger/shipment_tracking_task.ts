import 'reflect-metadata';
import { logger, schedules } from '@trigger.dev/sdk/v3';
import { initLazyServices } from '../fetchr/core/lazyServices';
import { checkAndUpdateShippingStatus } from '../fetchr/modules/shipping/shippingEmailService';

export const shipmentTrackingCronTask = schedules.task({
  id: 'shipment-tracking-cron',
  maxDuration: 60_000,
  cron: '0 * * * *',
  run: async (payload, _context) => {
    logger.log('Shipment tracking cron started', {
      payload,
      scheduledTime: payload.timestamp,
      nextRuns: payload.upcoming,
    });

    try {
      const { productService, logService, shippingEmailService, orderManagementService } =
        await initLazyServices();
      logService.info('Services initialized successfully in Trigger.dev task');
      const product = await productService.getSampleProduct();
      logService.info('Product fetched', {
        metadata: { productId: product.id, name: product.name },
      });

      await shippingEmailService.processAllEmails();
      await checkAndUpdateShippingStatus();
      await orderManagementService.lockAndTerminateOldCards();

      logger.log('Product fetched', { productId: product.id, name: product.name });

      return { success: true, productId: product.id, name: product.name };
    } catch (error) {
      logger.error('Error in shipment cron task', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
  machine: { preset: 'medium-1x' },
});
