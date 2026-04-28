/**
 * Quota Management Service
 * Handles quota checks, usage tracking, and reset logic.
 */

import prisma from "../db.server";

export interface QuotaCheck {
  allowed: boolean;
  remaining: number;
  total: number;
  used: number;
  plan: string;
  message?: string;
}

/**
 * Check if shop has remaining quota for a generation
 */
export async function checkQuota(shopDomain: string): Promise<QuotaCheck> {
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
  });

  if (!shop) {
    return {
      allowed: false,
      remaining: 0,
      total: 0,
      used: 0,
      plan: "none",
      message: "Shop not found",
    };
  }

  // Check if quota needs reset (monthly)
  const now = new Date();
  if (shop.quotaResetDate && now >= shop.quotaResetDate) {
    const nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    await prisma.shop.update({
      where: { shopDomain },
      data: { usedQuota: 0, quotaResetDate: nextReset },
    });
    shop.usedQuota = 0;
  }

  // Set initial reset date if not set
  if (!shop.quotaResetDate) {
    const nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    await prisma.shop.update({
      where: { shopDomain },
      data: { quotaResetDate: nextReset },
    });
  }

  const remaining = Math.max(0, shop.monthlyQuota - shop.usedQuota);

  if (remaining <= 0) {
    return {
      allowed: false,
      remaining: 0,
      total: shop.monthlyQuota,
      used: shop.usedQuota,
      plan: shop.plan,
      message: "Monthly quota exceeded. Please upgrade your plan.",
    };
  }

  return {
    allowed: true,
    remaining,
    total: shop.monthlyQuota,
    used: shop.usedQuota,
    plan: shop.plan,
  };
}

/**
 * Increment used quota after successful generation
 */
export async function incrementQuota(shopDomain: string): Promise<void> {
  await prisma.shop.update({
    where: { shopDomain },
    data: { usedQuota: { increment: 1 } },
  });
}

/**
 * Get quota info without modifying
 */
export async function getQuotaInfo(shopDomain: string): Promise<QuotaCheck> {
  return checkQuota(shopDomain);
}
