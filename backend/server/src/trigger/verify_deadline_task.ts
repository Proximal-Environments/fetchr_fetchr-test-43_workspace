import 'reflect-metadata';
import { logger, schedules } from '@trigger.dev/sdk/v3';
import { initLazyServices } from '../fetchr/core/lazyServices';
import { NOTIFICATION_TYPE } from '../shared/notifications';
import { supabaseDb } from '../fetchr/base/database/supabaseDb';

async function handleVerifyItemsDeadlineNotifications(
  services: Awaited<ReturnType<typeof initLazyServices>>,
): Promise<void> {
  const { notificationsService } = services;
  const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
  const toNotify = await supabaseDb.order_suggestion.findMany({
    where: {
      status: 'Pending',
      verify_suggestions_by: {
        lte: oneHourFromNow,
        gt: new Date(),
      },
    },
    include: {
      orders_v2: true,
    },
  });

  for (const suggestion of toNotify) {
    try {
      const referenceName = `verify_items_1hour_${suggestion.id}`;
      const alreadySent = await supabaseDb.sent_notifications.findUnique({
        where: { reference_name: referenceName },
      });

      if (!alreadySent) {
        await notificationsService.sendNotification(
          NOTIFICATION_TYPE.ORDER_SUGGESTION,
          suggestion.orders_v2.customer_id,
          {
            orderId: suggestion.orders_v2.id,
            orderSuggestionId: suggestion.id,
            title: 'Last call',
            body: "There's only 1 hour left! Make any final changes before we ship your order out.",
          },
        );

        await supabaseDb.sent_notifications.create({
          data: {
            reference_name: referenceName,
          },
        });
      }
    } catch (error) {
      logger.error('Error sending notification:', { error });
    }
  }
}

async function handleVerifyPurchasesDeadlineNotifications(
  services: Awaited<ReturnType<typeof initLazyServices>>,
): Promise<void> {
  const { notificationsService } = services;
  const now = new Date();
  const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const twoDaysFromNow = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);

  const toNotify = await supabaseDb.order_suggestion.findMany({
    where: {
      status: 'Reviewed',
      verify_purchase_by: {
        gt: now,
        lte: twoHoursFromNow,
      },
      shipment: {
        some: {
          status: 'Delivered',
        },
        every: {
          status: 'Delivered',
        },
      },
    },
    include: {
      orders_v2: true,
      shipment: true,
    },
  });

  const twoDaysToNotify = await supabaseDb.order_suggestion.findMany({
    where: {
      status: 'Reviewed',
      verify_purchase_by: {
        gt: now,
        lte: twoDaysFromNow,
      },
      shipment: {
        some: {
          status: 'Delivered',
        },
        every: {
          status: 'Delivered',
        },
      },
    },
    include: {
      orders_v2: true,
      shipment: true,
    },
  });

  // Handle 2-hour notifications
  for (const suggestion of toNotify) {
    try {
      if (!suggestion.shipment || suggestion.shipment.length === 0) continue;

      const referenceName = `verify_purchase_2hour_${suggestion.id}`;
      const alreadySent = await supabaseDb.sent_notifications.findUnique({
        where: { reference_name: referenceName },
      });

      if (!alreadySent) {
        await notificationsService.sendNotification(
          NOTIFICATION_TYPE.ORDER_SUGGESTION,
          suggestion.orders_v2.customer_id,
          {
            orderId: suggestion.orders_v2.id,
            orderSuggestionId: suggestion.id,
            title: 'Last chance',
            body: "Time's almost up! Let us know if you're keeping or returning your items.",
          },
        );

        await supabaseDb.sent_notifications.create({
          data: {
            reference_name: referenceName,
          },
        });
      }
    } catch (error) {
      logger.error('Error sending notification:', { error });
    }
  }

  // Handle 2-day notifications
  for (const suggestion of twoDaysToNotify) {
    try {
      const referenceName = `verify_purchase_2day_${suggestion.id}`;
      const alreadySent = await supabaseDb.sent_notifications.findUnique({
        where: { reference_name: referenceName },
      });

      if (!alreadySent) {
        await notificationsService.sendNotification(
          NOTIFICATION_TYPE.ORDER_SUGGESTION,
          suggestion.orders_v2.customer_id,
          {
            orderId: suggestion.orders_v2.id,
            orderSuggestionId: suggestion.id,
            title: 'Keep or return?',
            body: "Still deciding? You have 2 days left to let us know if you're keeping or returning your items.",
          },
        );

        await supabaseDb.sent_notifications.create({
          data: {
            reference_name: referenceName,
          },
        });
      }
    } catch (error) {
      logger.error('Error sending notification:', { error });
    }
  }
}

async function finalizeExpiredOrders(
  services: Awaited<ReturnType<typeof initLazyServices>>,
): Promise<void> {
  const { orderManagementService } = services;
  const toUpdate = await supabaseDb.order_suggestion.findMany({
    where: {
      status: 'Pending',
      verify_suggestions_by: {
        lte: new Date(),
      },
    },
    include: {
      orders_v2: true,
    },
  });

  for (const suggestion of toUpdate) {
    try {
      await orderManagementService.finalizeOrderSuggestion(
        { orderSuggestionId: suggestion.id },
        suggestion.orders_v2.customer_id,
        true,
      );
    } catch (error) {
      logger.error('Error finalizing order suggestion:', { error });
    }
  }
}

async function expireOrderSuggestion(
  services: Awaited<ReturnType<typeof initLazyServices>>,
): Promise<void> {
  const { orderManagementService } = services;
  const toExpire = await supabaseDb.order_suggestion.findMany({
    where: {
      status: 'Pending',
      expire_suggestions_by: {
        lte: new Date(),
      },
    },
    include: {
      orders_v2: {
        select: {
          id: true,
          customer_id: true,
        },
      },
    },
  });

  for (const suggestion of toExpire) {
    try {
      await orderManagementService.setSuggestionArchived(suggestion.id, true);
    } catch (error) {
      logger.error('Error expiring order suggestion:', { error });
    }
  }
}

export const verifyDeadlineTask = schedules.task({
  id: 'verify-deadline-task',
  maxDuration: 5 * 60 * 1000, // 5 minutes in milliseconds
  cron: '0 * * * *', // Run every 5 minutes
  run: async (payload, _context) => {
    logger.log('Verify deadline task started', {
      payload,
      scheduledTime: payload.timestamp,
      nextRuns: payload.upcoming,
    });

    const services = await initLazyServices();

    try {
      logger.info('Processing deadline verifications');

      await Promise.allSettled([
        handleVerifyItemsDeadlineNotifications(services),
        handleVerifyPurchasesDeadlineNotifications(services),
        finalizeExpiredOrders(services),
        expireOrderSuggestion(services),
      ]);

      return { success: true, completed: true };
    } catch (error) {
      logger.error('Error in verify deadline task', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
  machine: { preset: 'medium-1x' },
});
