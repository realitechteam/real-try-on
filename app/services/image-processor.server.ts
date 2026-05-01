/**
 * Image Processing Utilities
 * Validates uploads, normalizes via sharp, stores in Cloudflare R2.
 */

import path from "path";
import { v4 as uuid } from "uuid";
import { putObject, getSignedGetUrl } from "./r2.server";

const MAX_SIZE_BYTES = parseInt(process.env.MAX_IMAGE_SIZE_MB || "10", 10) * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_DIMENSION = 2048;
const SIGNED_URL_TTL_SEC = 3600;

export interface ImageValidationResult {
  valid: boolean;
  error?: string;
}

export interface ProcessedImage {
  key: string;
  signedUrl: string;
  width: number;
  height: number;
  sizeBytes: number;
}

export function validateImage(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): ImageValidationResult {
  if (!ALLOWED_TYPES.includes(mimeType)) {
    return {
      valid: false,
      error: `Unsupported file type: ${mimeType}. Allowed: JPEG, PNG, WebP.`,
    };
  }

  if (buffer.length > MAX_SIZE_BYTES) {
    const maxMB = MAX_SIZE_BYTES / (1024 * 1024);
    return {
      valid: false,
      error: `File too large (${(buffer.length / (1024 * 1024)).toFixed(1)}MB). Maximum: ${maxMB}MB.`,
    };
  }

  const ext = path.extname(fileName).toLowerCase();
  if (![".jpg", ".jpeg", ".png", ".webp"].includes(ext)) {
    return { valid: false, error: `Unsupported file extension: ${ext}` };
  }

  return { valid: true };
}

export async function processAndStoreImage(
  buffer: Buffer,
  mimeType: string,
  shopDomain: string,
): Promise<ProcessedImage> {
  let processedBuffer = buffer;
  let width = 0;
  let height = 0;

  try {
    const sharp = (await import("sharp")).default;
    const metadata = await sharp(buffer).metadata();
    width = metadata.width || 0;
    height = metadata.height || 0;

    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      processedBuffer = await sharp(buffer)
        .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: "inside", withoutEnlargement: true })
        .toBuffer();
      const newMetadata = await sharp(processedBuffer).metadata();
      width = newMetadata.width || 0;
      height = newMetadata.height || 0;
    }

    // Strip EXIF and auto-rotate based on EXIF orientation.
    processedBuffer = await sharp(processedBuffer).rotate().toBuffer();
  } catch (e) {
    console.warn("[ImageProcessor] sharp unavailable, storing raw image", e);
  }

  const ext =
    mimeType === "image/png" ? ".png" : mimeType === "image/webp" ? ".webp" : ".jpg";
  const fileId = uuid();
  const key = `tryon/${shopDomain.replace(/\./g, "_")}/${fileId}${ext}`;

  await putObject(key, processedBuffer, mimeType);
  const signedUrl = await getSignedGetUrl(key, SIGNED_URL_TTL_SEC);

  return {
    key,
    signedUrl,
    width,
    height,
    sizeBytes: processedBuffer.length,
  };
}
