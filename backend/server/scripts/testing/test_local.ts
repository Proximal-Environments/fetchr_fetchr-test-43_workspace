import { createChannel, createClient, ChannelCredentials } from 'nice-grpc';
import { BaseServiceDefinition, BaseServiceClient } from '@fetchr/schema/base/base';

async function runTest(): Promise<void> {
  try {
    const channel = createChannel('localhost:50053', ChannelCredentials.createInsecure());

    const baseServer: BaseServiceClient = createClient(BaseServiceDefinition, channel);

    console.log('Starting health check tests...');
    const startTime = Date.now();

    // Make 10 sequential health check calls
    for (let i = 1; i <= 10; i++) {
      console.log(`\nMaking health check call #${i}...`);
      const healthCheck = await baseServer.healthCheck({});
      console.log(`Health check #${i} response:`, healthCheck);

      // Add a small delay between requests to make logs more readable
      if (i < 10) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    const totalTime = (Date.now() - startTime) / 1000;
    console.log(`\nCompleted 10 health checks in ${totalTime.toFixed(2)} seconds`);
  } catch (error) {
    if (error instanceof Error) {
      console.error('Test failed with error:', {
        message: error.message,
        stack: error.stack,
        details: (error as { details?: unknown }).details,
        code: (error as { code?: unknown }).code,
      });
    } else {
      console.error('Test failed with unknown error:', error);
    }
    process.exit(1);
  }
}

runTest();
