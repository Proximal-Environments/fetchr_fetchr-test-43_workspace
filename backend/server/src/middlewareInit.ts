import * as tracker from '@middleware.io/node-apm';
import { hostname } from './hostname';

tracker.track({
  serviceName: 'fetchr-backend',
  accessToken: 'kvddeiyjdsxazrnwjtaqxzlbammltwteimzh',
  target: 'https://erynj.middleware.io',
  host: hostname,
  projectName: `fetchr-backend-${hostname}`,
});
