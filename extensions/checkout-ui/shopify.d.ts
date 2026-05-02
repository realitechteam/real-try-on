import '@shopify/ui-extensions';

//@ts-expect-error -- module augmentation for the JSX checkout block
declare module './src/Checkout.jsx' {
  const shopify: import('@shopify/ui-extensions/purchase.checkout.block.render').Api;
  const globalThis: { shopify: typeof shopify };
}
