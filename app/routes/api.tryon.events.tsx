/**
 * Analytics Events API
 * POST /api/tryon/events
 */

import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await request.json();
    const { shop, eventType, productId, variantId, sessionId, metadata } = body;

    if (!shop || !eventType) {
      return Response.json({ error: "Missing required fields" }, { status: 400 });
    }

    const validEvents = [
      "widget_impression", "widget_open", "photo_upload",
      "generation_start", "generation_complete", "generation_fail",
      "add_to_cart_after_tryon",
    ];

    if (!validEvents.includes(eventType)) {
      return Response.json({ error: "Invalid event type" }, { status: 400 });
    }

    const shopRecord = await db.shop.findUnique({ where: { shopDomain: shop } });
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
  } catch (error: any) {
    console.error("[Analytics API] Error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
