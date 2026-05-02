/**
 * App Proxy: Analytics Events
 * POST /apps/realtryon/tryon/events (storefront) → /proxy/tryon/events (app)
 */

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

const VALID_EVENTS = [
  "widget_impression",
  "widget_open",
  "photo_upload",
  "generation_start",
  "generation_complete",
  "generation_fail",
  "add_to_cart_after_tryon",
];

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const { session } = await authenticate.public.appProxy(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const { eventType, productId, variantId, sessionId, metadata } = body;

    if (!eventType) {
      return Response.json({ error: "Missing eventType" }, { status: 400 });
    }
    if (!VALID_EVENTS.includes(eventType)) {
      return Response.json({ error: "Invalid event type" }, { status: 400 });
    }

    const shopRecord = await db.shop.findUnique({ where: { shopDomain: session.shop } });
    if (!shopRecord) {
      return Response.json({ error: "Shop not found" }, { status: 404 });
    }

    await db.analyticsEvent.create({
      data: {
        shopId: shopRecord.id,
        eventType,
        productId: productId || undefined,
        variantId: variantId || undefined,
        sessionId: sessionId || undefined,
        metadata: metadata ? JSON.stringify(metadata) : undefined,
      },
    });

    return Response.json({ success: true });
  } catch (error) {
    console.error("[Analytics Proxy] Error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
