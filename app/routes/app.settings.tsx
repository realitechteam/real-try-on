import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useNavigation } from "react-router";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  let shop = await db.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) shop = await db.shop.create({ data: { shopDomain: session.shop } });
  return { shop };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const fd = await request.formData();
  const updates: Record<string, string | number | boolean> = {};
  for (const key of ["isEnabled","buttonLabel","buttonColor","buttonTextColor","buttonRadius","buttonPosition","modalTheme","productRule","enabledTags"]) {
    if (fd.has(key)) {
      const v = fd.get(key) as string;
      if (key === "isEnabled") updates[key] = v === "true";
      else if (key === "buttonRadius") updates[key] = parseInt(v, 10);
      else updates[key] = v;
    }
  }
  await db.shop.update({ where: { shopDomain: session.shop }, data: updates });
  return { success: true };
};

export default function SettingsPage() {
  const { shop } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const nav = useNavigation();
  const saving = nav.state === "submitting";

  const [isEnabled, setIsEnabled] = useState(shop.isEnabled);
  const [buttonLabel, setButtonLabel] = useState(shop.buttonLabel);
  const [buttonColor, setButtonColor] = useState(shop.buttonColor);
  const [buttonTextColor, setButtonTextColor] = useState(shop.buttonTextColor);
  const [buttonRadius, setButtonRadius] = useState(shop.buttonRadius);
  const [buttonPosition, setButtonPosition] = useState(shop.buttonPosition);
  const [modalTheme, setModalTheme] = useState(shop.modalTheme);
  const [productRule, setProductRule] = useState(shop.productRule);
  const [enabledTags, setEnabledTags] = useState(shop.enabledTags || "");

  const save = useCallback(() => {
    const fd = new FormData();
    fd.set("isEnabled", String(isEnabled));
    fd.set("buttonLabel", buttonLabel);
    fd.set("buttonColor", buttonColor);
    fd.set("buttonTextColor", buttonTextColor);
    fd.set("buttonRadius", String(buttonRadius));
    fd.set("buttonPosition", buttonPosition);
    fd.set("modalTheme", modalTheme);
    fd.set("productRule", productRule);
    fd.set("enabledTags", enabledTags);
    submit(fd, { method: "post" });
  }, [isEnabled, buttonLabel, buttonColor, buttonTextColor, buttonRadius, buttonPosition, modalTheme, productRule, enabledTags, submit]);

  return (
    <s-page heading="Settings">
      <s-button slot="primary-action" onClick={save} {...(saving ? { loading: true } : {})}>
        Save
      </s-button>

      {/* Enable/Disable */}
      <s-section heading="Virtual Try-On Status">
        <s-stack direction="inline" gap="base" alignItems="center">
          <s-stack direction="block" gap="small-100">
            <s-heading>Enable Virtual Try-On</s-heading>
            <s-text color="subdued">Shows the button on eligible product pages.</s-text>
          </s-stack>
          <s-button
            variant={isEnabled ? "primary" : "secondary"}
            onClick={() => setIsEnabled(!isEnabled)}
          >
            {isEnabled ? "Enabled" : "Disabled"}
          </s-button>
        </s-stack>
      </s-section>

      {/* Widget Appearance */}
      <s-section heading="Widget Appearance">
        <s-stack direction="block" gap="base">
          <s-text-field
            label="Button Label"
            value={buttonLabel}
            onChange={(e) => setButtonLabel((e.target as HTMLInputElement).value)}
          />
          <s-stack direction="inline" gap="base">
            <s-text-field
              label="Button Color"
              value={buttonColor}
              onChange={(e) => setButtonColor((e.target as HTMLInputElement).value)}
            />
            <s-text-field
              label="Text Color"
              value={buttonTextColor}
              onChange={(e) => setButtonTextColor((e.target as HTMLInputElement).value)}
            />
          </s-stack>
          <s-number-field
            label="Border Radius"
            value={String(buttonRadius)}
            min={0}
            max={24}
            step={2}
            onChange={(e) => setButtonRadius(Number((e.target as HTMLInputElement).value))}
          />
          <s-select
            label="Button Position"
            value={buttonPosition}
            onChange={(e) => setButtonPosition((e.target as HTMLSelectElement).value)}
          >
            <option value="below-add-to-cart">Below Add to Cart</option>
            <option value="above-add-to-cart">Above Add to Cart</option>
            <option value="below-description">Below Description</option>
            <option value="custom">Custom (App Block)</option>
          </s-select>
          <s-select
            label="Modal Theme"
            value={modalTheme}
            onChange={(e) => setModalTheme((e.target as HTMLSelectElement).value)}
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="auto">Auto</option>
          </s-select>

          {/* Preview */}
          <s-divider />
          <s-heading>Preview</s-heading>
          <s-box padding="large" background="subdued" borderRadius="base">
            <div style={{ display: "flex", justifyContent: "center" }}>
              <button
                type="button"
                style={{
                  backgroundColor: buttonColor,
                  color: buttonTextColor,
                  border: "none",
                  borderRadius: `${buttonRadius}px`,
                  padding: "12px 24px",
                  fontSize: "14px",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "Inter, sans-serif",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                👗 {buttonLabel}
              </button>
            </div>
          </s-box>
        </s-stack>
      </s-section>

      {/* Product Rules */}
      <s-section heading="Product Rules">
        <s-stack direction="block" gap="base">
          <s-choice-list
            label="Show try-on button on"
            values={[productRule]}
            onChange={(e) => setProductRule((e.target as HTMLInputElement).value)}
          >
            <s-choice value="all">All products</s-choice>
            <s-choice value="tagged">Products with specific tags</s-choice>
            <s-choice value="collection">Selected collections</s-choice>
          </s-choice-list>
          {productRule === "tagged" && (
            <s-text-field
              label="Product Tags"
              value={enabledTags}
              onChange={(e) => setEnabledTags((e.target as HTMLInputElement).value)}
              details="Comma-separated tags"
            />
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
