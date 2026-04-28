/**
 * Storefront API: Try-On Generation Endpoint
 * POST /api/tryon/generate
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { generateTryOn } from "../services/tryon-engine.server";
import { validateImage, processAndStoreImage } from "../services/image-processor.server";
import { checkQuota, incrementQuota } from "../services/quota.server";

// Simple in-memory rate limiter
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const formData = await request.formData();
    const shopDomain = formData.get("shop") as string;
    const garmentImageUrl = formData.get("garment_image_url") as string;
    const productId = formData.get("product_id") as string | null;
    const variantId = formData.get("variant_id") as string | null;
    const productTitle = formData.get("product_title") as string | null;
    const sessionId = formData.get("session_id") as string | null;
    const personImageFile = formData.get("person_image") as File | null;

    if (!shopDomain || !garmentImageUrl) {
      return Response.json({ error: "Missing required fields: shop, garment_image_url" }, { status: 400 });
    }
    if (!personImageFile) {
      return Response.json({ error: "Missing person_image file" }, { status: 400 });
    }

    // Rate limit
    const rlKey = `${shopDomain}:${sessionId || request.headers.get("x-forwarded-for") || "anon"}`;
    if (!checkRateLimit(rlKey)) {
      return Response.json({ error: "Too many requests" }, { status: 429 });
    }

    // Verify shop
    const shop = await db.shop.findUnique({ where: { shopDomain } });
    if (!shop) return Response.json({ error: "Shop not found" }, { status: 404 });
    if (!shop.isEnabled) return Response.json({ error: "Virtual try-on is not enabled" }, { status: 403 });

    // Check quota
    const quota = await checkQuota(shopDomain);
    if (!quota.allowed) {
      return Response.json({ error: "Quota exceeded", message: quota.message, quota: { remaining: quota.remaining, total: quota.total } }, { status: 402 });
    }

    // Validate image
    const buffer = Buffer.from(await personImageFile.arrayBuffer());
    const validation = validateImage(buffer, personImageFile.type, personImageFile.name);
    if (!validation.valid) {
      return Response.json({ error: validation.error }, { status: 400 });
    }

    const processedImage = await processAndStoreImage(buffer, personImageFile.type, shopDomain);

    // Create generation record
    const generation = await db.generation.create({
      data: {
        shopId: shop.id,
        productId: productId || undefined,
        variantId: variantId || undefined,
        productTitle: productTitle || undefined,
        personImageUrl: processedImage.publicUrl,
        garmentImageUrl,
        status: "processing",
        sessionId: sessionId || undefined,
      },
    });

    // Track event
    await db.analyticsEvent.create({
      data: { shopId: shop.id, eventType: "generation_start", productId: productId || undefined, variantId: variantId || undefined, sessionId: sessionId || undefined },
    });

    // Run AI generation
    const result = await generateTryOn({
      personImageUrl: processedImage.publicUrl,
      garmentImageUrl,
      productId: productId || undefined,
      variantId: variantId || undefined,
      shopDomain,
    });

    // Update record
    await db.generation.update({
      where: { id: generation.id },
      data: {
        status: result.success ? "completed" : "failed",
        resultImageUrl: result.resultImageUrl || null,
        providerJobId: result.providerJobId || null,
        provider: result.provider,
        errorMessage: result.errorMessage || null,
        processingTimeMs: result.processingTimeMs || null,
        completedAt: new Date(),
      },
    });

    if (result.success) {
      await incrementQuota(shopDomain);
      await db.analyticsEvent.create({
        data: { shopId: shop.id, eventType: "generation_complete", productId: productId || undefined, variantId: variantId || undefined, sessionId: sessionId || undefined, metadata: JSON.stringify({ processingTimeMs: result.processingTimeMs }) },
      });

      return Response.json({
        success: true,
        resultImageUrl: result.resultImageUrl,
        generationId: generation.id,
        quota: { remaining: quota.remaining - 1, total: quota.total },
      });
    } else {
      await db.analyticsEvent.create({
        data: { shopId: shop.id, eventType: "generation_fail", productId: productId || undefined, sessionId: sessionId || undefined, metadata: JSON.stringify({ error: result.errorMessage }) },
      });
      return Response.json({ success: false, error: result.errorMessage || "Generation failed", generationId: generation.id }, { status: 500 });
    }
  } catch (error: any) {
    console.error("[TryOn API] Error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET - return shop config for storefront widget
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const shopDomain = url.searchParams.get("shop");
  if (!shopDomain) return Response.json({ error: "Missing shop parameter" }, { status: 400 });

  const shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) return Response.json({ error: "Shop not found" }, { status: 404 });

  return Response.json({
    isEnabled: shop.isEnabled,
    buttonLabel: shop.buttonLabel,
    buttonColor: shop.buttonColor,
    buttonTextColor: shop.buttonTextColor,
    buttonRadius: shop.buttonRadius,
    buttonPosition: shop.buttonPosition,
    modalTheme: shop.modalTheme,
    productRule: shop.productRule,
    enabledTags: shop.enabledTags?.split(",").map((t) => t.trim()) || [],
  });
}
