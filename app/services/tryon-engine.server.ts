/**
 * AI Virtual Try-On Engine Adapter
 * Pluggable provider interface for virtual try-on generation.
 */

export interface TryOnRequest {
  personImageUrl: string;
  garmentImageUrl: string;
  productId?: string;
  variantId?: string;
  shopDomain: string;
}

export interface TryOnResult {
  success: boolean;
  resultImageUrl?: string;
  providerJobId?: string;
  errorMessage?: string;
  processingTimeMs?: number;
  provider: string;
}

/**
 * FASHN.ai Provider
 * Primary provider for high-quality fashion try-on
 */
async function generateWithFashn(req: TryOnRequest): Promise<TryOnResult> {
  const apiKey = process.env.FASHN_API_KEY;
  const apiUrl = process.env.FASHN_API_URL || "https://api.fashn.ai/v1";

  if (!apiKey) {
    return { success: false, errorMessage: "FASHN API key not configured", provider: "fashn" };
  }

  const startTime = Date.now();

  try {
    // Step 1: Create try-on job
    const createRes = await fetch(`${apiUrl}/try-on`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model_image: req.personImageUrl,
        garment_image: req.garmentImageUrl,
        category: "auto",
      }),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      return {
        success: false,
        errorMessage: `FASHN API error: ${createRes.status} - ${errText}`,
        provider: "fashn",
      };
    }

    const createData = await createRes.json();
    const jobId = createData.id;

    // Step 2: Poll for result (max 60 seconds)
    const maxWait = 60000;
    const pollInterval = 2000;
    let elapsed = 0;

    while (elapsed < maxWait) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      elapsed += pollInterval;

      const statusRes = await fetch(`${apiUrl}/try-on/${jobId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (!statusRes.ok) continue;

      const statusData = await statusRes.json();

      if (statusData.status === "completed" && statusData.output) {
        return {
          success: true,
          resultImageUrl: statusData.output,
          providerJobId: jobId,
          processingTimeMs: Date.now() - startTime,
          provider: "fashn",
        };
      }

      if (statusData.status === "failed") {
        return {
          success: false,
          errorMessage: statusData.error || "Generation failed",
          providerJobId: jobId,
          processingTimeMs: Date.now() - startTime,
          provider: "fashn",
        };
      }
    }

    return {
      success: false,
      errorMessage: "Generation timed out after 60 seconds",
      providerJobId: jobId,
      processingTimeMs: Date.now() - startTime,
      provider: "fashn",
    };
  } catch (error) {
    return {
      success: false,
      errorMessage: `FASHN error: ${error instanceof Error ? error.message : String(error)}`,
      processingTimeMs: Date.now() - startTime,
      provider: "fashn",
    };
  }
}

/**
 * Replicate Provider (fallback)
 * Uses IDM-VTON model on Replicate
 */
async function generateWithReplicate(req: TryOnRequest): Promise<TryOnResult> {
  const apiToken = process.env.REPLICATE_API_TOKEN;
  if (!apiToken) {
    return { success: false, errorMessage: "Replicate API token not configured", provider: "replicate" };
  }

  const startTime = Date.now();

  try {
    const createRes = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify({
        version: "c871bb9b046c1b1c205305526fcc6cd0606f77666e1d84dd9d39d0e9bfdb4f77",
        input: {
          human_img: req.personImageUrl,
          garm_img: req.garmentImageUrl,
          garment_des: "clothing item",
          is_checked: true,
          is_checked_crop: false,
          denoise_steps: 30,
          seed: 42,
        },
      }),
    });

    if (!createRes.ok) {
      return {
        success: false,
        errorMessage: `Replicate error: ${createRes.status}`,
        provider: "replicate",
      };
    }

    const prediction = await createRes.json();
    const predictionId = prediction.id;

    // Poll for result
    const maxWait = 120000;
    const pollInterval = 3000;
    let elapsed = 0;

    while (elapsed < maxWait) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      elapsed += pollInterval;

      const statusRes = await fetch(
        `https://api.replicate.com/v1/predictions/${predictionId}`,
        { headers: { Authorization: `Bearer ${apiToken}` } }
      );

      if (!statusRes.ok) continue;
      const statusData = await statusRes.json();

      if (statusData.status === "succeeded" && statusData.output) {
        const outputUrl = Array.isArray(statusData.output) ? statusData.output[0] : statusData.output;
        return {
          success: true,
          resultImageUrl: outputUrl,
          providerJobId: predictionId,
          processingTimeMs: Date.now() - startTime,
          provider: "replicate",
        };
      }

      if (statusData.status === "failed") {
        return {
          success: false,
          errorMessage: statusData.error || "Replicate generation failed",
          providerJobId: predictionId,
          processingTimeMs: Date.now() - startTime,
          provider: "replicate",
        };
      }
    }

    return {
      success: false,
      errorMessage: "Replicate generation timed out",
      providerJobId: predictionId,
      processingTimeMs: Date.now() - startTime,
      provider: "replicate",
    };
  } catch (error) {
    return {
      success: false,
      errorMessage: `Replicate error: ${error instanceof Error ? error.message : String(error)}`,
      processingTimeMs: Date.now() - startTime,
      provider: "replicate",
    };
  }
}

/**
 * Mock Provider (development/testing)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function generateWithMock(_req: TryOnRequest): Promise<TryOnResult> {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  return {
    success: true,
    resultImageUrl: "https://placehold.co/512x768/1a1a2e/ffffff?text=Try-On+Result",
    providerJobId: `mock-${Date.now()}`,
    processingTimeMs: 2000,
    provider: "mock",
  };
}

/**
 * Main generation function with provider fallback
 */
export async function generateTryOn(req: TryOnRequest): Promise<TryOnResult> {
  // Use mock in development if no API keys configured
  if (!process.env.FASHN_API_KEY && !process.env.REPLICATE_API_TOKEN) {
    console.warn("[VirtualTryOn] No AI provider configured, using mock");
    return generateWithMock(req);
  }

  // Try primary provider first
  if (process.env.FASHN_API_KEY) {
    const result = await generateWithFashn(req);
    if (result.success) return result;
    console.warn(`[VirtualTryOn] FASHN failed: ${result.errorMessage}, trying fallback...`);
  }

  // Fallback to Replicate
  if (process.env.REPLICATE_API_TOKEN) {
    return generateWithReplicate(req);
  }

  return {
    success: false,
    errorMessage: "No AI provider available",
    provider: "none",
  };
}
