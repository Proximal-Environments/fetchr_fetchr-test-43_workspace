import { injectable } from 'inversify';
import { BaseService } from '../../base/service_injection/baseService';
import axios from 'axios';
import { VoyageEmbeddingModel } from '@fetchr/schema/core/core';
import { convertVoyageEmbeddingModelToDbVoyageEmbeddingModel } from '../../../shared/converters';
import { logService } from '../../base/logging/logService';
@injectable()
export class VoyageService extends BaseService {
  private readonly apiKey: string;
  private readonly baseUrl: string = 'https://api.voyageai.com/v1';
  private readonly defaultModel: VoyageEmbeddingModel = VoyageEmbeddingModel.VOYAGE_LARGE_3;

  constructor() {
    super('VoyageService', logService);
    this.apiKey = process.env.VOYAGE_API_KEY || '';
  }

  public async embedText(
    text: string,
    model?: VoyageEmbeddingModel,
    outputDimension?: number,
  ): Promise<number[]> {
    const voyageModel = model ?? this.defaultModel;
    if (voyageModel !== VoyageEmbeddingModel.VOYAGE_LARGE_3) {
      throw new Error('Unsupported model');
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/embeddings`,
        {
          input: [text],
          model: convertVoyageEmbeddingModelToDbVoyageEmbeddingModel(voyageModel),
          output_dimension: outputDimension ?? 2048,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        },
      );

      return response.data.data[0].embedding;
    } catch (error) {
      this.logService.error('Error in embedText:', {
        error,
        metadata: { text, error },
      });
      throw new Error('Failed to generate embedding');
    }
  }

  public async batchEmbedText(
    texts: string[],
    model?: VoyageEmbeddingModel,
    outputDimensions?: number,
  ): Promise<number[][]> {
    const voyageModel = model ?? this.defaultModel;
    if (voyageModel !== VoyageEmbeddingModel.VOYAGE_LARGE_3) {
      throw new Error('Unsupported model');
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/embeddings`,
        {
          input: texts,
          model: convertVoyageEmbeddingModelToDbVoyageEmbeddingModel(voyageModel),
          output_dimension: outputDimensions ?? 2048,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        },
      );

      console.log('[Response]', JSON.stringify(response.data, null, 2));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return response.data.data.map((item: any) => item.embedding);
    } catch (error) {
      this.logService.error('Error in batchEmbedText:', {
        error,
        metadata: { texts },
      });
      throw new Error('Failed to generate batch embeddings');
    }
  }

  public async embedMultimodal(
    text: string,
    image?: string,
    outputDimension?: number,
  ): Promise<number[]>;
  public async embedMultimodal(
    text: string,
    imageBuffer: Buffer,
    outputDimension?: number,
  ): Promise<number[]>;
  public async embedMultimodal(
    text: string,
    imageInput?: string | Buffer,
    outputDimension?: number,
  ): Promise<number[]> {
    outputDimension;
    try {
      const imageContent = !imageInput
        ? undefined
        : typeof imageInput === 'string'
          ? { type: 'image_url', image_url: imageInput }
          : {
              type: 'image_base64',
              image_base64: `data:image/jpeg;base64,${imageInput.toString('base64')}`,
            };

      const response = await axios.post(
        `${this.baseUrl}/multimodalembeddings`,
        {
          inputs: [
            {
              content: [
                {
                  type: 'text',
                  text: text,
                },
                ...(imageContent ? [imageContent] : []),
              ],
            },
          ],
          model: 'voyage-multimodal-3',
          //   output_dimension: outputDimension ?? 1024,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        },
      );

      console.log('[Response]', JSON.stringify(response.data, null, 2));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return response.data.data[0].embedding;
    } catch (error) {
      console.error(error);
      this.logService.error('Error in embedMultimodal:', {
        error,
        metadata: { text },
      });
      throw new Error('Failed to generate multimodal embedding');
    }
  }
}
