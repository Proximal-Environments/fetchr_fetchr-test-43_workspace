import { injectable } from 'inversify';
import { BaseService } from '../../base/service_injection/baseService';
import { CohereClient } from 'cohere-ai';
import { logService } from '../../base/logging/logService';

@injectable()
export class CohereService extends BaseService {
  private client: CohereClient;

  constructor() {
    super('CohereService', logService);
    this.client = new CohereClient({
      token: process.env.COHERE_API_KEY || '',
    });
  }

  public async rerank(
    query: string,
    documents: string[],
    topN: number = 3,
  ): Promise<{ index: number; relevanceScore: number }[]> {
    try {
      const response = await this.client.v2.rerank({
        query,
        documents,
        topN,
        model: 'rerank-v3.5',
      });

      return response.results;
    } catch (error) {
      this.logService.error('Error in rerank:', {
        error,
        metadata: {
          query,
          documents,
        },
      });
      throw new Error('Failed to rerank documents');
    }
  }
}
