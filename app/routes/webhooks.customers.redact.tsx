import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// GDPR: customers/redact
// No PII keyed to a Shopify customer ID is stored — see notes in
// webhooks.customers.data_request.tsx. Acknowledge and log.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`[GDPR] ${topic} for ${shop}`, JSON.stringify(payload));
  return new Response();
};
