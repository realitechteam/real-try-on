/**
 * Image Processing Utilities
 * Handles validation, resizing, and temporary storage of uploaded images.
 */

import { writeFile, mkdir, unlink, stat } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { v4 as uuid } from "uuid";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";
const MAX_SIZE_BYTES = (parseInt(process.env.MAX_IMAGE_SIZE_MB || "10", 10)) * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_DIMENSION = 2048;

export interface ImageValidationResult {
  valid: boolean;
  error?: string;
}

export interface ProcessedImage {
  filePath: string;
  publicUrl: string;
  width: number;
  height: number;
  sizeBytes: number;
}

/**
 * Validate uploaded image file
 */
export function validateImage(
  buffer: Buffer,
  mimeType: string,
  fileName: string
): ImageValidationResult {
  // Check mime type
  if (!ALLOWED_TYPES.includes(mimeType)) {
    return {
      valid: false,
      error: `Unsupported file type: ${mimeType}. Allowed: JPEG, PNG, WebP.`,
    };
  }

  // Check file size
  if (buffer.length > MAX_SIZE_BYTES) {
    const maxMB = MAX_SIZE_BYTES / (1024 * 1024);
    return {
      valid: false,
      error: `File too large (${(buffer.length / (1024 * 1024)).toFixed(1)}MB). Maximum: ${maxMB}MB.`,
    };
  }

  // Check file extension
  const ext = path.extname(fileName).toLowerCase();
  if (![".jpg", ".jpeg", ".png", ".webp"].includes(ext)) {
    return {
      valid: false,
      error: `Unsupported file extension: ${ext}`,
    };
  }

  return { valid: true };
}

/**
 * Process and store uploaded image
 * Resizes if needed and saves to temporary storage
 */
export async function processAndStoreImage(
  buffer: Buffer,
  mimeType: string,
  shopDomain: string
): Promise<ProcessedImage> {
  // Ensure upload directory exists
  const shopDir = path.join(UPLOAD_DIR, shopDomain.replace(/\./g, "_"));
  if (!existsSync(shopDir)) {
    await mkdir(shopDir, { recursive: true });
  }

  const fileId = uuid();
  const ext = mimeType === "image/png" ? ".png" : mimeType === "image/webp" ? ".webp" : ".jpg";
  const fileName = `${fileId}${ext}`;
  const filePath = path.join(shopDir, fileName);

  let processedBuffer = buffer;
  let width = 0;
  let height = 0;

  try {
    // Try to use sharp for image processing
    const sharp = (await import("sharp")).default;
    const metadata = await sharp(buffer).metadata();
    width = metadata.width || 0;
    height = metadata.height || 0;

    // Resize if too large
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      processedBuffer = await sharp(buffer)
        .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: "inside", withoutEnlargement: true })
        .toBuffer();

      const newMetadata = await sharp(processedBuffer).metadata();
      width = newMetadata.width || 0;
      height = newMetadata.height || 0;
    }

    // Strip EXIF data for privacy
    processedBuffer = await sharp(processedBuffer)
      .rotate() // auto-rotate based on EXIF
      .toBuffer();
  } catch (e) {
    // If sharp is not available, save raw
    console.warn("[ImageProcessor] Sharp not available, saving raw image");
  }

  await writeFile(filePath, processedBuffer);

  const appUrl = process.env.SHOPIFY_APP_URL || process.env.APP_URL || "http://localhost:3000";
  const publicUrl = `${appUrl}/uploads/${shopDomain.replace(/\./g, "_")}/${fileName}`;

  return {
    filePath,
    publicUrl,
    width,
    height,
    sizeBytes: processedBuffer.length,
  };
}

/**
 * Delete an uploaded image
 */
export async function deleteImage(filePath: string): Promise<void> {
  try {
    if (existsSync(filePath)) {
      await unlink(filePath);
    }
  } catch (e) {
    console.warn(`[ImageProcessor] Failed to delete: ${filePath}`);
  }
}

/**
 * Clean up old images (retention policy)
 */
export async function cleanupOldImages(maxAgeHours: number = 24): Promise<number> {
  const { readdir } = await import("fs/promises");
  let deleted = 0;
  const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;

  if (!existsSync(UPLOAD_DIR)) return 0;

  const shopDirs = await readdir(UPLOAD_DIR);
  for (const dir of shopDirs) {
    const fullDir = path.join(UPLOAD_DIR, dir);
    try {
      const files = await readdir(fullDir);
      for (const file of files) {
        const filePath = path.join(fullDir, file);
        const fileStat = await stat(filePath);
        if (fileStat.mtimeMs < cutoff) {
          await unlink(filePath);
          deleted++;
        }
      }
    } catch (e) {
      // Skip directories we can't read
    }
  }

  return deleted;
}
