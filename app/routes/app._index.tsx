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

      <s-layout>
        <s-layout-column>
          {/* Status cards */}
          <s-section>
            <s-columns columns="3" gap="base">
              <s-card>
                <s-stack direction="block" gap="tight">
                  <s-text variant="headingSm">Status</s-text>
                  <s-badge tone={shop.isEnabled ? "success" : "critical"}>
                    {shop.isEnabled ? "Active" : "Disabled"}
                  </s-badge>
                  <s-text tone="subdued">
                    Plan: <strong>{shop.plan.charAt(0).toUpperCase() + shop.plan.slice(1)}</strong>
                  </s-text>
                </s-stack>
              </s-card>

              <s-card>
                <s-stack direction="block" gap="tight">
                  <s-text variant="headingSm">Quota Usage</s-text>
                  <s-text>
                    {shop.usedQuota} / {shop.monthlyQuota} ({shop.quotaPct}%)
                  </s-text>
                  <s-progress-bar
                    value={shop.quotaPct}
                    tone={shop.quotaPct > 80 ? "critical" : undefined}
                    size="small"
                  />
                </s-stack>
              </s-card>

              <s-card>
                <s-stack direction="block" gap="tight">
                  <s-text variant="headingSm">Last 30 Days</s-text>
                  <s-text variant="headingLg">{stats.last30}</s-text>
                  <s-text tone="subdued">try-on generations</s-text>
                </s-stack>
              </s-card>
            </s-columns>
          </s-section>

          {/* Performance overview */}
          <s-section heading="Performance Overview">
            <s-columns columns="4" gap="base">
              <s-stack direction="block" gap="extraTight">
                <s-text tone="subdued">Total Generations</s-text>
                <s-text variant="headingLg">{stats.totalGens}</s-text>
              </s-stack>
              <s-stack direction="block" gap="extraTight">
                <s-text tone="subdued">This Week</s-text>
                <s-text variant="headingLg">{stats.last7}</s-text>
              </s-stack>
              <s-stack direction="block" gap="extraTight">
                <s-text tone="subdued">Widget Opens (30d)</s-text>
                <s-text variant="headingLg">{stats.widgetOpens}</s-text>
              </s-stack>
              <s-stack direction="block" gap="extraTight">
                <s-text tone="subdued">Failed</s-text>
                <s-text variant="headingLg" tone="critical">{stats.failedCount}</s-text>
              </s-stack>
            </s-columns>
          </s-section>

          {/* Recent generations */}
          <s-section heading="Recent Generations">
            {recentGens.length === 0 ? (
              <s-box padding="extraLarge">
                <s-text tone="subdued" alignment="center">
                  No generations yet. Once customers start using Virtual Try-On, you'll see results here.
                </s-text>
              </s-box>
            ) : (
              <s-resource-list>
                {recentGens.map((gen: any) => (
                  <s-resource-item key={gen.id}>
                    <s-stack direction="inline" gap="base" blockAlign="center">
                      <s-stack direction="block" gap="extraTight">
                        <s-text fontWeight="semibold">{gen.productTitle}</s-text>
                        <s-text tone="subdued" variant="bodySm">
                          {new Date(gen.createdAt).toLocaleString()}
                        </s-text>
                      </s-stack>
                      <s-badge
                        tone={
                          gen.status === "completed" ? "success" :
                          gen.status === "failed" ? "critical" :
                          gen.status === "processing" ? "attention" : "info"
                        }
                      >
                        {gen.status}
                      </s-badge>
                    </s-stack>
                  </s-resource-item>
                ))}
              </s-resource-list>
            )}
          </s-section>
        </s-layout-column>
      </s-layout>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
