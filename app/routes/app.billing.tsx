import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSubmit } from "react-router";
import { authenticate, PLANS, PLAN_STARTER, PLAN_GROWTH, PLAN_PRO } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";

const FREE_PLAN = "Free";

const PLAN_CARDS = [
  {
    id: FREE_PLAN,
    name: "Free",
    price: 0,
    quota: 50,
    features: ["50 generations/month", "Basic widget", "Standard support"],
  },
  {
    id: PLAN_STARTER,
    name: "Starter",
    price: PLANS[PLAN_STARTER].amount,
    quota: PLANS[PLAN_STARTER].quota,
    features: ["500 generations/month", "Full customization", "Analytics", "Email support"],
  },
  {
    id: PLAN_GROWTH,
    name: "Growth",
    price: PLANS[PLAN_GROWTH].amount,
    quota: PLANS[PLAN_GROWTH].quota,
    features: ["2,000 generations/month", "Full customization", "Advanced analytics", "Priority support"],
  },
  {
    id: PLAN_PRO,
    name: "Pro",
    price: PLANS[PLAN_PRO].amount,
    quota: PLANS[PLAN_PRO].quota,
    features: ["5,000 generations/month", "Full customization", "Attribution analytics", "Dedicated support"],
  },
];

// SDK types `plans` as `(keyof Config['billing'])[]`, but the generic doesn't flow
// through the shopifyApp() factory in v1.1, so it collapses to `never[]`. Runtime
// values match the configured handles, so cast at the call sites.
const PAID_PLANS = [PLAN_STARTER, PLAN_GROWTH, PLAN_PRO];
const isTest = process.env.SHOPIFY_BILLING_TEST !== "false";

function quotaForPlan(planId: string): number {
  return PLAN_CARDS.find((p) => p.id === planId)?.quota ?? 50;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const check = await billing.check({ plans: PAID_PLANS as never[], isTest });
  const activePlan = check.hasActivePayment ? check.appSubscriptions[0]?.name ?? FREE_PLAN : FREE_PLAN;

  // Reconcile quota with the active plan from Shopify.
  const expectedQuota = quotaForPlan(activePlan);
  const shop = await db.shop.findUnique({ where: { shopDomain: session.shop } });
  if (shop && (shop.plan !== activePlan || shop.monthlyQuota !== expectedQuota)) {
    await db.shop.update({
      where: { shopDomain: session.shop },
      data: { plan: activePlan, monthlyQuota: expectedQuota },
    });
  }

  return {
    currentPlan: activePlan,
    usedQuota: shop?.usedQuota ?? 0,
    monthlyQuota: expectedQuota,
    plans: PLAN_CARDS,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const fd = await request.formData();
  const planId = fd.get("planId") as string;

  if (planId === FREE_PLAN) {
    // Cancel any active subscriptions and downgrade locally.
    const check = await billing.check({ plans: PAID_PLANS as never[], isTest });
    for (const sub of check.appSubscriptions) {
      await billing.cancel({ subscriptionId: sub.id, isTest, prorate: true });
    }
    await db.shop.update({
      where: { shopDomain: session.shop },
      data: { plan: FREE_PLAN, monthlyQuota: 50 },
    });
    return { success: true };
  }

  if (!PAID_PLANS.includes(planId)) {
    return { error: "Invalid plan" };
  }

  await billing.require({
    plans: [planId] as never[],
    isTest,
    onFailure: async () =>
      billing.request({
        plan: planId as never,
        isTest,
        returnUrl: `${process.env.SHOPIFY_APP_URL}/app/billing`,
      }),
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
      <s-banner tone="info">
        Current plan: <strong>{currentPlan}</strong> — {usedQuota} of {monthlyQuota} generations used this month.
      </s-banner>

      <s-section>
        <s-grid gap="base" gridTemplateColumns="repeat(4, minmax(0, 1fr))">
          {plans.map((plan) => (
            <s-section key={plan.id}>
              <s-stack direction="block" gap="base">
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-heading>{plan.name}</s-heading>
                  {currentPlan === plan.id && <s-badge tone="success">Current</s-badge>}
                </s-stack>
                <s-heading>
                  {plan.price === 0 ? "Free" : `$${plan.price}`}
                </s-heading>
                {plan.price > 0 && <s-text color="subdued">/month</s-text>}
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
                >
                  {currentPlan === plan.id ? "Current Plan" : plan.price === 0 ? "Downgrade" : "Upgrade"}
                </s-button>
              </s-stack>
            </s-section>
          ))}
        </s-grid>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
