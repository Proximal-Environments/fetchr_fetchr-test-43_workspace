import { exploreRequestService, userService } from '../../src/fetchr/base/service_injection/global';

const user = await userService.getProfileByEmailOrFail('navidkpour@gmail.com');

const startTime = Date.now();
const requests = await exploreRequestService.listRequests(user.id, 1, 100, false);
const endTime = Date.now();
console.log(`Time taken: ${endTime - startTime}ms`);
console.log(`Number of requests: ${requests.length}`);
