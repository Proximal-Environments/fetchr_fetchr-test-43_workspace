import { PrismaClient, style_picker_products } from '@prisma/client';
import { S3Service } from '../src/fetchr/core/aws/s3/s3Service';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { AnthropicService } from '../src/fetchr/core/anthropic/anthropicService';
import { AnthropicModel } from '../src/proto/core/core';
import { Perf } from '../src/fetchr/core/performance/performance';
import { MessageParam } from '@anthropic-ai/sdk/resources';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();
const s3Service = new S3Service();
const perf = new Perf();
const anthropicService = new AnthropicService(perf);

const SUPPORTED_FORMATS = ['.png', '.jpg', '.jpeg', '.avif', '.webp'];

function mapGender(genderString: string): 'MALE' | 'FEMALE' {
  const normalized = genderString.toLowerCase();
  if (normalized === 'men' || normalized === 'male') {
    return 'MALE';
  } else if (normalized === 'women' || normalized === 'female') {
    return 'FEMALE';
  } else {
    throw new Error(
      `Invalid gender: ${genderString}. Expected 'men', 'women', 'male', or 'female'`,
    );
  }
}

async function convertToPng(inputBuffer: Buffer): Promise<Buffer> {
  return sharp(inputBuffer).png().toBuffer();
}

async function compressImageForDescription(inputBuffer: Buffer): Promise<Buffer> {
  console.log('Compressing image for description');
  const MAX_SIZE_MB = 4; // Stay well under 5MB limit
  const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

  let compressedBuffer = inputBuffer;
  let quality = 80;
  let maxWidth = 1920;

  // First try resizing if it's a large image
  const metadata = await sharp(inputBuffer).metadata();
  if (metadata.width && metadata.width > maxWidth) {
    compressedBuffer = await sharp(inputBuffer)
      .resize(maxWidth, null, { withoutEnlargement: true })
      .png({ quality })
      .toBuffer();
  }

  // If still too large, progressively reduce quality and size
  while (compressedBuffer.length > MAX_SIZE_BYTES && quality > 20) {
    quality -= 10;
    maxWidth = Math.floor(maxWidth * 0.8);

    compressedBuffer = await sharp(inputBuffer)
      .resize(maxWidth, null, { withoutEnlargement: true })
      .png({ quality })
      .toBuffer();
  }

  // Final check - if still too large, make it much smaller
  if (compressedBuffer.length > MAX_SIZE_BYTES) {
    compressedBuffer = await sharp(inputBuffer)
      .resize(800, null, { withoutEnlargement: true })
      .png({ quality: 30 })
      .toBuffer();
  }

  return compressedBuffer;
}

interface ImageGroup {
  base: string;
  sticker: string;
  gender: string;
  brand: string;
  baseFileName: string;
  stickerFileName: string;
}

interface ProcessingStats {
  added: number;
  skippedExisting: number;
  skippedIncomplete: string[];
  errors: string[];
}

async function getImageDescription(imageBuffer: Buffer): Promise<string> {
  try {
    const message: MessageParam = {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Please describe this clothing item concisely in 1-2 sentences. Focus on the item type, color, key details, and style. Be specific and to the point but feel free to go into detail as needed on more complex items.',
        },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: imageBuffer.toString('base64'),
          },
        },
      ],
    };

    const response = await anthropicService.submitChatCompletion([message], {
      model: AnthropicModel.CLAUDE_3_7_SONNET_LATEST,
      temperature: 0.7,
    });

    if (typeof response.content === 'string') {
      return response.content;
    }

    const textContent = response.content.find(block => block.type === 'text');
    return textContent?.text || '';
  } catch (error) {
    console.error('Error getting image description:', error);
    throw error;
  }
}

async function uploadStylePickerImages(): Promise<void> {
  const baseDir = path.join(__dirname, '../../../app/assets/style_picker_images');
  const stats: ProcessingStats = {
    added: 0,
    skippedExisting: 0,
    skippedIncomplete: [],
    errors: [],
  };

  let totalImagesInFolder = 0; // Add counter for total images

  try {
    // First fetch all existing products to check for duplicates
    const existingProducts = await prisma.style_picker_products.findMany();

    const existingFileNames = new Set(existingProducts.map(p => p.file_name).filter(Boolean));

    // Read all files in the directory
    const files = fs.readdirSync(baseDir);
    console.log(`\n=== Found ${files.length} total files in directory ===`);

    // Group files by their gender_brand combination
    const imageGroups = new Map<string, ImageGroup>();

    files.forEach(file => {
      const filePath = path.join(baseDir, file);
      if (!fs.statSync(filePath).isFile()) {
        console.log(`Skipping non-file: ${file}`);
        return;
      }

      const ext = path.extname(file).toLowerCase();
      if (!SUPPORTED_FORMATS.includes(ext)) {
        console.log(`Skipping unsupported format: ${file} (${ext})`);
        return;
      }

      totalImagesInFolder++; // Increment counter for each supported image
      console.log(`Processing file ${totalImagesInFolder}: ${file}`);

      // Remove extension for parsing
      const nameWithoutExt = path.basename(file, ext);
      const parts = nameWithoutExt.split('_');

      if (parts.length < 2) {
        stats.errors.push(`Invalid format for ${file}: Expected at least gender_brand`);
        console.log(`ERROR: Invalid format for ${file}`);
        return;
      }

      const gender = parts[0].toUpperCase();
      const brand = parts[1];
      // Handle potential trailing underscore in sticker names (e.g., "male_arcteryx_gorp_sticker_.png")
      const trimmedName = nameWithoutExt.replace(/_+$/, ''); // Remove trailing underscores
      const isSticker = trimmedName.toLowerCase().endsWith('_sticker');

      // For grouping, we need to extract the base product name (without _sticker suffix)
      let productBaseName;
      if (isSticker) {
        // Remove _sticker from the end to get the base product name
        productBaseName = trimmedName.replace(/_sticker$/, '');
      } else {
        productBaseName = trimmedName;
      }

      // Create a key using the full base product name (gender_brand_productdetails)
      const groupKey = productBaseName;
      console.log(`  -> Group: ${groupKey}, Type: ${isSticker ? 'sticker' : 'base'}`);

      const group = imageGroups.get(groupKey) || {
        base: '',
        sticker: '',
        gender,
        brand,
        baseFileName: '',
        stickerFileName: '',
      };

      if (isSticker) {
        group.sticker = filePath;
        group.stickerFileName = file;
      } else {
        group.base = filePath;
        group.baseFileName = file;
      }

      imageGroups.set(groupKey, group);
    });

    console.log(`\n=== Created ${imageGroups.size} groups from ${totalImagesInFolder} images ===`);

    // Log all groups and their completeness
    for (const [groupKey, group] of imageGroups) {
      const hasBase = !!group.base;
      const hasSticker = !!group.sticker;
      console.log(
        `Group ${groupKey}: base=${hasBase ? '✓' : '✗'} sticker=${hasSticker ? '✓' : '✗'}`,
      );
      if (hasBase) console.log(`  Base: ${group.baseFileName}`);
      if (hasSticker) console.log(`  Sticker: ${group.stickerFileName}`);
    }

    // Process each group
    for (const [groupKey, group] of imageGroups) {
      if (!group.base || !group.sticker) {
        stats.skippedIncomplete.push(
          `${group.baseFileName || group.stickerFileName} (missing ${
            !group.base ? 'base' : 'sticker'
          } image)`,
        );
        continue;
      }

      // Skip if base file has already been processed
      if (existingFileNames.has(group.baseFileName)) {
        stats.skippedExisting++;
        continue;
      }

      try {
        // Read and convert images to PNG if needed
        const baseImageBuffer = await convertToPng(fs.readFileSync(group.base));
        const stickerImageBuffer = await convertToPng(fs.readFileSync(group.sticker));

        // Create compressed version of base image for description (to stay under 5MB limit)
        const compressedBaseImage = await compressImageForDescription(baseImageBuffer);

        // Get image description using Claude with compressed image
        const description = await getImageDescription(compressedBaseImage);

        // Update file paths to reflect PNG format for S3 upload
        const baseS3Path = group.base.replace(/\.[^/.]+$/, '.png');
        const stickerS3Path = group.sticker.replace(/\.[^/.]+$/, '.png');

        // Upload full-size images to S3
        const baseS3Url = await s3Service.uploadFileToRandomLocation(baseImageBuffer, baseS3Path);
        const stickerS3Url = await s3Service.uploadFileToRandomLocation(
          stickerImageBuffer,
          stickerS3Path,
        );

        if (!baseS3Url || !stickerS3Url) {
          stats.errors.push(`Failed to upload images for ${groupKey}`);
          continue;
        }

        // Create database entry with just the base file name
        const data: Omit<style_picker_products, 'id' | 'created_at'> = {
          model_image: baseS3Url,
          sticker_image: stickerS3Url,
          gender: mapGender(group.gender) as 'MALE' | 'FEMALE',
          brand: group.brand,
          file_name: group.baseFileName,
          category: null,
          description: description,
        };

        await prisma.style_picker_products.create({ data });
        stats.added++;
      } catch (error) {
        stats.errors.push(`Error processing ${groupKey}: ${error}`);
        throw error;
      }
    }

    // Log final statistics
    console.log('\n=== Processing Summary ===');
    console.log(`Total images in folder: ${totalImagesInFolder}`);
    console.log(`Total products added: ${stats.added}`);
    console.log(`Skipped (already exists): ${stats.skippedExisting}`);

    if (stats.skippedIncomplete.length > 0) {
      console.log('\nIncomplete Groups:');
      stats.skippedIncomplete.forEach(group => console.log(`- ${group}`));
    }

    if (stats.errors.length > 0) {
      console.log('\nErrors:');
      stats.errors.forEach(error => console.log(`- ${error}`));
    }

    console.log('\nFinished processing all images');
  } catch (error) {
    console.error('Error processing images:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
uploadStylePickerImages().catch(console.error);
