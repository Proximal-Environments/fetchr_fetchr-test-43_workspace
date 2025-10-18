import { billingService } from '../src/fetchr/base/service_injection/global';

(async (): Promise<void> => {
  await billingService.deleteCustomerWithEmail('calvinchen24@hotmail.com');
})();
