import { createChannel, createClient, ChannelCredentials } from 'nice-grpc';
import { BaseServiceDefinition, BaseServiceClient } from '@fetchr/schema/base/base';

async function runTest(): Promise<void> {
  try {
    const channel = createChannel('localhost:8003', ChannelCredentials.createInsecure());

    const baseServer: BaseServiceClient = createClient(BaseServiceDefinition, channel);

    // First test the health check to ensure basic connectivity
    const healthCheck = await baseServer.healthCheck({});
    console.log('Health check response:', healthCheck);

    const startTime = Date.now();
    const endTime = startTime + 30000; // 30 seconds
    let count = 0;

    // Create batches of 10 parallel requests
    while (Date.now() < endTime) {
      const batchPromises = Array(10)
        .fill(null)
        .map(() =>
          baseServer.getTextEmbedding({
            query: 'Jeans',
          }),
        );

      await Promise.all(batchPromises);
      count += 10;
      console.log(`Processed ${count} embeddings...`);
    }

    const totalTime = (Date.now() - startTime) / 1000;
    console.log(`Completed ${count} embeddings in ${totalTime.toFixed(2)} seconds`);
    console.log(`Average rate: ${(count / totalTime).toFixed(2)} embeddings/second`);
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
