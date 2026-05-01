import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// GDPR: customers/data_request
// REAL TRY ON does not store PII keyed to a Shopify customer ID. Storefront
// sessions are anonymous (`vto_<random>`). We acknowledge the request and log it
// so merchants can demonstrate compliance. If a future feature ties customer IDs
// to generations, replace the log with a data export back to the merchant.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`[GDPR] ${topic} for ${shop}`, JSON.stringify(payload));
  return new Response();
};
