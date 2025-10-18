import { injectable } from 'inversify';
import { BaseService } from '../../base/service_injection/baseService';
import { logService } from '../../base/logging/logService';
export type RecordSparseValues = {
  indices: number[];
  values: number[];
};

@injectable()
export class SparseService extends BaseService {
  private cache: Map<string, RecordSparseValues> = new Map();

  constructor() {
    super('SparseService', logService);
  }

  public async getSparseVector(
    text: string,
    inputType: 'query' | 'passage',
    retries: number = 3,
  ): Promise<RecordSparseValues> {
    try {
      if (this.cache.has(text)) {
        const cached = this.cache.get(text);
        if (!cached) {
          throw new Error('Cached value was undefined');
        }
        return cached;
      }

      const vector = await fetch('http://127.0.0.1:9091/sparse/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: [text], input_type: inputType, return_tokens: false }),
      });

      const data = await vector.json();
      const sparseValues = data.embeddings[0];
      this.cache.set(text, sparseValues);
      return sparseValues;
    } catch (error) {
      this.logService.warn('Error getting sparse vector. Retrying...', {
        metadata: { text, retries },
        error,
      });
      if (retries > 0) {
        // 10ms backoff
        await new Promise(resolve => setTimeout(resolve, 10));
        return this.getSparseVector(text, inputType, retries - 1);
      }
      this.logService.error('3x Error getting sparse vector. Giving up.', {
        metadata: { text, retries },
        error,
      });
      throw error;
    }
  }
}
