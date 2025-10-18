import axios from 'axios';
import { BaseService } from '../../base/service_injection/baseService';
import { Gender } from '@fetchr/schema/base/base';

export type GoogleImage = {
  position: number;
  thumbnail: string;
  related_content_id: string;
  serpapi_related_content_link: string;
  source: string;
  source_logo: string;
  title: string;
  link: string;
  original: string;
  original_width: number;
  original_height: number;
  is_product: boolean;
};

export class PinterestService extends BaseService {
  public async searchPinterestImages(query: string, gender?: Gender): Promise<GoogleImage[]> {
    const apiKey = process.env.SERP_API_KEY;
    if (!apiKey) {
      throw new Error('SERP API key not found in environment variables');
    }

    const searchQuery =
      query +
      (gender === Gender.GENDER_MALE ? ' men' : gender === Gender.GENDER_FEMALE ? ' women' : '') +
      ' site:pinterest.com';
    const url = `https://serpapi.com/search.json?engine=google_images&q=${encodeURIComponent(searchQuery)}&api_key=${apiKey}&tbs=isz:l`;

    console.log(`Searching for: ${searchQuery}`);
    const response = await axios.get(url);

    if (!response.data || !response.data.images_results) {
      return [];
    }

    const images: GoogleImage[] = response.data.images_results;
    console.log(`Found ${images.length} images`);

    console.log(images[0], images[1]);
    let pinterestImages = images.filter(image => image.link.includes('pinterest.com'));
    console.log(`Found ${pinterestImages.length} pinterest large images`);

    if (!pinterestImages.length) {
      const url = `https://serpapi.com/search.json?engine=google_images&q=${encodeURIComponent(searchQuery)}&api_key=${apiKey}`;
      const response = await axios.get(url);
      const images: GoogleImage[] = response.data.images_results;
      console.log(`Found ${images.length} images`);
      pinterestImages = images.filter(image => image.link.includes('pinterest.com'));
      console.log(`Found ${pinterestImages.length} pinterest images (any image size)`);
    }

    return pinterestImages;
  }
}
