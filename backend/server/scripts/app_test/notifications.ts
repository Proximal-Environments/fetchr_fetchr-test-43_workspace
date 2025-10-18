import {
  notificationsService,
  orderManagementService,
  userService,
} from '../../src/fetchr/base/service_injection/global';
import { NOTIFICATION_TYPE } from '../../src/shared/notifications';

const user = await userService.getProfileByEmailOrFail('navid@fetchr.so');
const orderId = '32e96ff6-3983-42fc-94de-4b0367a70752';
const order = await orderManagementService.getOrder(orderId);
if (!order) {
  throw new Error('Order not found');
}

const chatId = order.chatId;
if (!chatId) {
  throw new Error('Order has no chat ID');
}

notificationsService.sendNotification(NOTIFICATION_TYPE.ORDER_READY, user.id, {
  orderId,
  chatId,
  title: 'Your order is ready!',
  body: 'Our stylist has selected a product for you. Check it out!',
});
