import sharp from 'sharp';

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 40_000_000;

export class InvalidImageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidImageError';
    this.status = 400;
  }
}

export async function processUploadedImage(buffer, { profile = false } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new InvalidImageError('image file is required');
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    const error = new InvalidImageError('image must be at most 10 MB');
    error.status = 413;
    throw error;
  }

  let metadata;
  try {
    metadata = await sharp(buffer, {
      failOn: 'error',
      limitInputPixels: MAX_IMAGE_PIXELS,
    }).metadata();
  } catch {
    throw new InvalidImageError('invalid or unsupported image');
  }
  if (!ALLOWED_FORMATS.has(metadata.format)) {
    throw new InvalidImageError('image must be JPEG, PNG, or WebP');
  }

  const base = sharp(buffer, {
    failOn: 'error',
    limitInputPixels: MAX_IMAGE_PIXELS,
  }).rotate();
  const displayPipeline = profile
    ? base.clone().resize(512, 512, { fit: 'cover', position: 'centre' })
    : base.clone().resize(2560, 2560, { fit: 'inside', withoutEnlargement: true });
  const thumbnailPipeline = profile
    ? base.clone().resize(128, 128, { fit: 'cover', position: 'centre' })
    : base.clone().resize(640, 360, { fit: 'cover', position: 'centre', withoutEnlargement: true });

  try {
    const [display, thumbnail] = await Promise.all([
      displayPipeline.webp({ quality: 85, alphaQuality: 90 }).toBuffer({ resolveWithObject: true }),
      thumbnailPipeline.webp({ quality: 80, alphaQuality: 85 }).toBuffer(),
    ]);
    return {
      display: display.data,
      thumbnail,
      mimeType: 'image/webp',
      width: display.info.width,
      height: display.info.height,
      byteSize: display.data.length + thumbnail.length,
    };
  } catch {
    throw new InvalidImageError('image could not be processed');
  }
}
