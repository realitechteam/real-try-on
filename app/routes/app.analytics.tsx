import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) return { stats: null, funnel: [], topProducts: [] };

  const now = new Date();
  const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const eventTypes = ["widget_impression", "widget_open", "photo_upload", "generation_start", "generation_complete", "generation_fail", "add_to_cart_after_tryon"];
  const counts: Record<string, number> = {};
  for (const t of eventTypes) {
    counts[t] = await db.analyticsEvent.count({
      where: { shopId: shop.id, eventType: t, createdAt: { gte: d30 } },
    });
  }

  const funnel = [
    { step: "Widget Impressions", count: counts.widget_impression, rate: 100 },
    { step: "Widget Opens", count: counts.widget_open, rate: counts.widget_impression ? Math.round(counts.widget_open / counts.widget_impression * 100) : 0 },
    { step: "Photo Uploads", count: counts.photo_upload, rate: counts.widget_open ? Math.round(counts.photo_upload / counts.widget_open * 100) : 0 },
    { step: "Generations Started", count: counts.generation_start, rate: counts.photo_upload ? Math.round(counts.generation_start / counts.photo_upload * 100) : 0 },
    { step: "Completed", count: counts.generation_complete, rate: counts.generation_start ? Math.round(counts.generation_complete / counts.generation_start * 100) : 0 },
    { step: "Add to Cart", count: counts.add_to_cart_after_tryon, rate: counts.generation_complete ? Math.round(counts.add_to_cart_after_tryon / counts.generation_complete * 100) : 0 },
  ];

  const topProducts = await db.generation.groupBy({
    by: ["productTitle"],
    where: { shopId: shop.id, createdAt: { gte: d30 } },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 10,
  });

  const totalGens = await db.generation.count({ where: { shopId: shop.id, createdAt: { gte: d30 } } });
  const completedGens = await db.generation.count({ where: { shopId: shop.id, createdAt: { gte: d30 }, status: "completed" } });
  const avgTime = await db.generation.aggregate({ where: { shopId: shop.id, createdAt: { gte: d30 }, status: "completed" }, _avg: { processingTimeMs: true } });

  return {
    stats: {
      totalGens,
      completedGens,
      successRate: totalGens ? Math.round(completedGens / totalGens * 100) : 0,
      avgTime: avgTime._avg.processingTimeMs ? Math.round(avgTime._avg.processingTimeMs / 1000 * 10) / 10 : 0,
    },
    funnel,
    topProducts: topProducts.map((p) => ({ title: p.productTitle || "Unknown", count: p._count.id })),
  };
};

export default function AnalyticsPage() {
  const { stats, funnel, topProducts } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Analytics">
      <s-text color="subdued">Last 30 days performance</s-text>

      <s-section>
        <s-grid gap="base" gridTemplateColumns="repeat(4, minmax(0, 1fr))">
          <s-section>
            <s-stack direction="block" gap="small-100">
              <s-text color="subdued">Total Generations</s-text>
              <s-heading>{String(stats?.totalGens ?? 0)}</s-heading>
            </s-stack>
          </s-section>
          <s-section>
            <s-stack direction="block" gap="small-100">
              <s-text color="subdued">Completed</s-text>
              <s-heading>{String(stats?.completedGens ?? 0)}</s-heading>
            </s-stack>
          </s-section>
          <s-section>
            <s-stack direction="block" gap="small-100">
              <s-text color="subdued">Success Rate</s-text>
              <s-heading>{`${stats?.successRate ?? 0}%`}</s-heading>
            </s-stack>
          </s-section>
          <s-section>
            <s-stack direction="block" gap="small-100">
              <s-text color="subdued">Avg Time</s-text>
              <s-heading>{`${stats?.avgTime ?? 0}s`}</s-heading>
            </s-stack>
          </s-section>
        </s-grid>
      </s-section>

      <s-section heading="Try-On Funnel">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #e1e3e5" }}>
              <th style={{ padding: "8px 12px", textAlign: "left", fontSize: "13px", color: "#6d7175" }}>Step</th>
              <th style={{ padding: "8px 12px", textAlign: "right", fontSize: "13px", color: "#6d7175" }}>Count</th>
              <th style={{ padding: "8px 12px", textAlign: "right", fontSize: "13px", color: "#6d7175" }}>Conv. Rate</th>
            </tr>
          </thead>
          <tbody>
            {funnel.map((f: any, i: number) => (
              <tr key={i} style={{ borderBottom: "1px solid #f1f2f3" }}>
                <td style={{ padding: "8px 12px", fontSize: "14px" }}>{f.step}</td>
                <td style={{ padding: "8px 12px", textAlign: "right", fontSize: "14px" }}>{f.count}</td>
                <td style={{ padding: "8px 12px", textAlign: "right", fontSize: "14px" }}>{f.rate}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </s-section>

      <s-section heading="Top Products">
        {topProducts.length === 0 ? (
          <s-box padding="large">
            <s-text color="subdued">No data yet</s-text>
          </s-box>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e1e3e5" }}>
                <th style={{ padding: "8px 12px", textAlign: "left", fontSize: "13px", color: "#6d7175" }}>Product</th>
                <th style={{ padding: "8px 12px", textAlign: "right", fontSize: "13px", color: "#6d7175" }}>Generations</th>
              </tr>
            </thead>
            <tbody>
              {topProducts.map((p: any, i: number) => (
                <tr key={i} style={{ borderBottom: "1px solid #f1f2f3" }}>
                  <td style={{ padding: "8px 12px", fontSize: "14px" }}>{p.title}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right", fontSize: "14px" }}>{p.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
