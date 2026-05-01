import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// GDPR: shop/redact
// Fires 48h after uninstall. Purge all shop-scoped data. R2 objects expire
// via the bucket lifecycle rule (24h), so no R2 calls are needed here.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`[GDPR] ${topic} for ${shop}`);

  const shopRecord = await db.shop.findUnique({ where: { shopDomain: shop } });
  if (shopRecord) {
    // Cascade deletes Generation + AnalyticsEvent (see schema relations).
    await db.shop.delete({ where: { id: shopRecord.id } });
  }
  await db.session.deleteMany({ where: { shop } });

  return new Response();
};
