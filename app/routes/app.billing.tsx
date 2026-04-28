import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSubmit } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";

const PLANS = [
  { id: "free", name: "Free", price: 0, quota: 50, features: ["50 generations/month", "Basic widget", "Standard support"], overage: null },
  { id: "starter", name: "Starter", price: 19, quota: 500, features: ["500 generations/month", "Full customization", "Analytics", "Email support", "$0.10/extra"], overage: 0.10 },
  { id: "growth", name: "Growth", price: 49, quota: 2000, features: ["2,000 generations/month", "Full customization", "Advanced analytics", "Priority support", "$0.07/extra"], overage: 0.07 },
  { id: "pro", name: "Pro", price: 99, quota: 5000, features: ["5,000 generations/month", "Full customization", "Attribution analytics", "Dedicated support", "$0.05/extra", "Custom branding"], overage: 0.05 },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { shopDomain: session.shop } });
  return {
    currentPlan: shop?.plan || "free",
    usedQuota: shop?.usedQuota || 0,
    monthlyQuota: shop?.monthlyQuota || 50,
    plans: PLANS,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const fd = await request.formData();
  const planId = fd.get("planId") as string;
  const plan = PLANS.find((p) => p.id === planId);
  if (!plan) return { error: "Invalid plan" };

  await db.shop.update({
    where: { shopDomain: session.shop },
    data: { plan: plan.id, monthlyQuota: plan.quota },
  });
  return { success: true };
};

export default function BillingPage() {
  const { currentPlan, usedQuota, monthlyQuota, plans } = useLoaderData<typeof loader>();
  const submit = useSubmit();

  const selectPlan = (planId: string) => {
    const fd = new FormData();
    fd.set("planId", planId);
    submit(fd, { method: "post" });
  };

  return (
    <s-page heading="Plans & Billing">
      <s-layout>
        <s-layout-column>
          <s-banner tone="info">
            Current plan: <strong>{currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)}</strong> — {usedQuota} of {monthlyQuota} generations used this month.
          </s-banner>

          <s-section>
            <s-columns columns="4" gap="base">
              {plans.map((plan) => (
                <s-card key={plan.id}>
                  <s-stack direction="block" gap="base">
                    <s-stack direction="inline" gap="tight" blockAlign="center">
                      <s-text variant="headingMd">{plan.name}</s-text>
                      {currentPlan === plan.id && <s-badge tone="success">Current</s-badge>}
                    </s-stack>
                    <s-text variant="headingXl">
                      {plan.price === 0 ? "Free" : `$${plan.price}`}
                    </s-text>
                    {plan.price > 0 && <s-text tone="subdued">/month</s-text>}
                    <s-divider />
                    <s-unordered-list>
                      {plan.features.map((f, i) => (
                        <s-list-item key={i}>{f}</s-list-item>
                      ))}
                    </s-unordered-list>
                    <s-button
                      variant={currentPlan === plan.id ? "secondary" : "primary"}
                      disabled={currentPlan === plan.id}
                      onClick={() => selectPlan(plan.id)}
                      fullWidth
                    >
                      {currentPlan === plan.id ? "Current Plan" : plan.price === 0 ? "Downgrade" : "Upgrade"}
                    </s-button>
                  </s-stack>
                </s-card>
              ))}
            </s-columns>
          </s-section>
        </s-layout-column>
      </s-layout>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
