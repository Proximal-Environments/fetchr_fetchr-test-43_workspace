import { config } from 'dotenv';
import { NOTIFICATION_TYPE } from '../src/shared/notifications';
import { notificationsService } from '../src/fetchr/base/service_injection/global';
config();

// import { slackService } from '../src/fetchr/base/service_injection/global';

// if (!process.env.SLACK_ONBOARDING_NOTIFICATION_CHANNEL_ID) {
//   throw new Error('SLACK_ONBOARDING_NOTIFICATION_CHANNEL_ID is not set');
// }

// await slackService.sendMessage(
//   process.env.SLACK_ONBOARDING_NOTIFICATION_CHANNEL_ID,
//   `New user completed onboarding!`,
//   {
//     blocks: [
//       {
//         type: 'section',
//         text: {
//           type: 'mrkdwn',
//           text: `Test message`,
//         },
//       },
//     ],
//   },
// );

await notificationsService.sendNotification(
  NOTIFICATION_TYPE.AUTOMATIC_ORDER_PURCHASED,
  'e38b0628-2ce2-4acd-b329-99367358c2c2',
  {
    orderId: '57483731-c79c-40ee-909b-af6f40f3e4a0',
    chatId: '30c829bd-6003-4919-8528-00767527f7ae',
    title: 'We purchased a product for you!',
    body: 'You saved $32.40 on this purchase! Tracking info coming soon.',
  },
);
