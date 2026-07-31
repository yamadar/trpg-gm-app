// @vitest-environment node
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { InvalidImageError, processUploadedImage } from './imageProcessing.js';

describe('processUploadedImage', () => {
  it('normalizes content images to WebP display and thumbnail variants', async () => {
    const input = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: '#336699' },
    }).png().toBuffer();
    const result = await processUploadedImage(input);
    expect(result.mimeType).toBe('image/webp');
    expect(result.width).toBe(1200);
    expect(result.height).toBe(800);
    expect((await sharp(result.display).metadata()).format).toBe('webp');
    const thumbnail = await sharp(result.thumbnail).metadata();
    expect(thumbnail.width).toBe(640);
    expect(thumbnail.height).toBe(360);
  });

  it('creates square profile variants', async () => {
    const input = await sharp({
      create: { width: 900, height: 500, channels: 3, background: '#993333' },
    }).jpeg().toBuffer();
    const result = await processUploadedImage(input, { profile: true });
    expect([result.width, result.height]).toEqual([512, 512]);
    const thumbnail = await sharp(result.thumbnail).metadata();
    expect([thumbnail.width, thumbnail.height]).toEqual([128, 128]);
  });

  it('rejects non-image input', async () => {
    await expect(processUploadedImage(Buffer.from('not an image'))).rejects.toBeInstanceOf(InvalidImageError);
  });
});
