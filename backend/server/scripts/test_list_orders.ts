// import { orderManagementService } from '../src/fetchr/base/service_injection/global';

import { exploreRequestService } from '../src/fetchr/base/service_injection/global';

// import { orderManagementService } from '../src/fetchr/base/service_injection/global';

const request = await exploreRequestService.getRequestOrFail(
  '2908a17b-a76e-4b47-8376-a2c447fff849',
);
console.log('[Request]', JSON.stringify(request.messages, null, 2));
