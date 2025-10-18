// import 'reflect-metadata';
// import { logger, schedules } from '@trigger.dev/sdk/v3';
// import { initLazyServices } from '../fetchr/core/lazyServices';

// export const paymentHandlingTask = schedules.task({
//   id: 'payment-handling-task',
//   maxDuration: 60 * 60 * 1000, // 1 hour in milliseconds
//   cron: '0 * * * *', // Run every hour
//   run: async (payload, _context) => {
//     logger.log('Payment handling task started', {
//       payload,
//       scheduledTime: payload.timestamp,
//       nextRuns: payload.upcoming,
//     });

//     const { orderManagementService } = await initLazyServices();

//     try {
//       logger.info('Processing payments');
//       await orderManagementService.chargeVerifiedPurchases();
//       return { success: true, completed: true };
//     } catch (error) {
//       logger.error('Error in payment handling task', {
//         error: error instanceof Error ? error.message : String(error),
//       });
//       return { success: false, error: error instanceof Error ? error.message : String(error) };
//     }
//   },
//   machine: { preset: 'medium-1x' },
// });
