import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  let shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) {
    shop = await db.shop.create({
      data: { shopDomain, accessToken: session.accessToken ?? undefined },
    });
  }

  const now = new Date();
  const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [totalGens, last30, last7, failedCount, widgetOpens, recentGens] =
    await Promise.all([
      db.generation.count({ where: { shopId: shop.id } }),
      db.generation.count({ where: { shopId: shop.id, createdAt: { gte: d30 } } }),
      db.generation.count({ where: { shopId: shop.id, createdAt: { gte: d7 } } }),
      db.generation.count({ where: { shopId: shop.id, status: "failed" } }),
      db.analyticsEvent.count({ where: { shopId: shop.id, eventType: "widget_open", createdAt: { gte: d30 } } }),
      db.generation.findMany({ where: { shopId: shop.id }, orderBy: { createdAt: "desc" }, take: 5 }),
    ]);

  const quotaPct = shop.monthlyQuota > 0 ? Math.round((shop.usedQuota / shop.monthlyQuota) * 100) : 0;

  return {
    shop: {
      shopDomain: shop.shopDomain,
      isEnabled: shop.isEnabled,
      plan: shop.plan,
      monthlyQuota: shop.monthlyQuota,
      usedQuota: shop.usedQuota,
      quotaPct,
    },
    stats: { totalGens, last30, last7, failedCount, widgetOpens },
    recentGens: recentGens.map((g) => ({
      id: g.id,
      productTitle: g.productTitle || "Unknown Product",
      status: g.status,
      createdAt: g.createdAt.toISOString(),
    })),
  };
};

export default function DashboardPage() {
  const { shop, stats, recentGens } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Virtual Try-On Dashboard">
      {!shop.isEnabled && (
        <s-banner tone="warning" heading="Virtual Try-On is disabled">
          The try-on widget is not visible to your customers.{" "}
          <s-link href="/app/settings">Enable in Settings</s-link>
        </s-banner>
      )}

      {/* Status cards */}
      <s-section>
        <s-grid gap="base" gridTemplateColumns="repeat(3, minmax(0, 1fr))">
          <s-section>
            <s-stack direction="block" gap="small">
              <s-heading>Status</s-heading>
              <s-badge tone={shop.isEnabled ? "success" : "critical"}>
                {shop.isEnabled ? "Active" : "Disabled"}
              </s-badge>
              <s-text color="subdued">
                Plan: <strong>{shop.plan.charAt(0).toUpperCase() + shop.plan.slice(1)}</strong>
              </s-text>
            </s-stack>
          </s-section>

          <s-section>
            <s-stack direction="block" gap="small">
              <s-heading>Quota Usage</s-heading>
              <s-text>
                {shop.usedQuota} / {shop.monthlyQuota} ({shop.quotaPct}%)
              </s-text>
              <div
                style={{
                  height: "8px",
                  width: "100%",
                  background: "#e1e3e5",
                  borderRadius: "4px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${Math.min(shop.quotaPct, 100)}%`,
                    background: shop.quotaPct > 80 ? "#d72c0d" : "#008060",
                  }}
                />
              </div>
            </s-stack>
          </s-section>

          <s-section>
            <s-stack direction="block" gap="small">
              <s-heading>Last 30 Days</s-heading>
              <s-heading>{String(stats.last30)}</s-heading>
              <s-text color="subdued">try-on generations</s-text>
            </s-stack>
          </s-section>
        </s-grid>
      </s-section>

      {/* Performance overview */}
      <s-section heading="Performance Overview">
        <s-grid gap="base" gridTemplateColumns="repeat(4, minmax(0, 1fr))">
          <s-stack direction="block" gap="small-100">
            <s-text color="subdued">Total Generations</s-text>
            <s-heading>{String(stats.totalGens)}</s-heading>
          </s-stack>
          <s-stack direction="block" gap="small-100">
            <s-text color="subdued">This Week</s-text>
            <s-heading>{String(stats.last7)}</s-heading>
          </s-stack>
          <s-stack direction="block" gap="small-100">
            <s-text color="subdued">Widget Opens (30d)</s-text>
            <s-heading>{String(stats.widgetOpens)}</s-heading>
          </s-stack>
          <s-stack direction="block" gap="small-100">
            <s-text color="subdued">Failed</s-text>
            <s-heading>{String(stats.failedCount)}</s-heading>
          </s-stack>
        </s-grid>
      </s-section>

      {/* Recent generations */}
      <s-section heading="Recent Generations">
        {recentGens.length === 0 ? (
          <s-box padding="large-100">
            <s-text color="subdued">
              No generations yet. Once customers start using Virtual Try-On, you&apos;ll see results here.
            </s-text>
          </s-box>
        ) : (
          <s-stack direction="block" gap="small">
            {recentGens.map((gen) => (
              <s-box
                key={gen.id}
                padding="base"
                border="base"
                borderRadius="base"
              >
                <s-stack direction="inline" gap="base" alignItems="center">
                  <s-stack direction="block" gap="small-100">
                    <s-heading>{gen.productTitle}</s-heading>
                    <s-text color="subdued">
                      {new Date(gen.createdAt).toLocaleString()}
                    </s-text>
                  </s-stack>
                  <s-badge
                    tone={
                      gen.status === "completed" ? "success" :
                      gen.status === "failed" ? "critical" :
                      gen.status === "processing" ? "warning" : "info"
                    }
                  >
                    {gen.status}
                  </s-badge>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
