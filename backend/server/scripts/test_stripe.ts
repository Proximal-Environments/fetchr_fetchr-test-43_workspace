import { billingService } from '../src/fetchr/base/service_injection/global';

const customerId = 'cus_RnZtle0MQeJ3nM';
const amountInCents = 50;

const paymentIntentId = await billingService.chargeCustomer(customerId, amountInCents);
console.log(`Payment intent ID: ${paymentIntentId}`);
