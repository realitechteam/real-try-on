import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

export const PLAN_STARTER = "Starter";
export const PLAN_GROWTH = "Growth";
export const PLAN_PRO = "Pro";

export const PLANS: Record<string, { amount: number; quota: number }> = {
  [PLAN_STARTER]: { amount: 19, quota: 500 },
  [PLAN_GROWTH]: { amount: 49, quota: 2000 },
  [PLAN_PRO]: { amount: 99, quota: 5000 },
};

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  // shopify-app-react-router nests its own `@shopify/shopify-api` (v13) while
  // the prisma session-storage adapter is built against root v12. Shapes are
  // runtime-compatible; TS only sees a private-field mismatch on Session.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sessionStorage: new PrismaSessionStorage(prisma) as any,
  distribution: AppDistribution.AppStore,
  billing: {
    [PLAN_STARTER]: {
      lineItems: [
        {
          amount: PLANS[PLAN_STARTER].amount,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
    },
    [PLAN_GROWTH]: {
      lineItems: [
        {
          amount: PLANS[PLAN_GROWTH].amount,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
    },
    [PLAN_PRO]: {
      lineItems: [
        {
          amount: PLANS[PLAN_PRO].amount,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
    },
  },
  hooks: {
    afterAuth: async ({ session }) => {
      // Ensure shop record exists for Virtual Try-On
      const shopDomain = session.shop;
      const existingShop = await prisma.shop.findUnique({
        where: { shopDomain },
      });

      if (!existingShop) {
        await prisma.shop.create({
          data: {
            shopDomain,
            accessToken: session.accessToken,
            installedAt: new Date(),
          },
        });
        console.log(`[VirtualTryOn] Created shop record for ${shopDomain}`);
      } else {
        await prisma.shop.update({
          where: { shopDomain },
          data: { accessToken: session.accessToken, isEnabled: true },
        });
        console.log(`[VirtualTryOn] Updated shop record for ${shopDomain}`);
      }
    },
  },
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
