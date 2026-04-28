/**
 * Virtual Try-On Widget - Storefront JavaScript
 * Handles the complete try-on flow: upload → preview → generate → result
 */

(function () {
  "use strict";

  // Session ID for analytics tracking
  const SESSION_ID =
    "vto_" + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);

  /**
   * Initialize all try-on buttons on the page
   */
  function init() {
    const buttons = document.querySelectorAll("[id^='vto-trigger-']");
    buttons.forEach((btn) => {
      const blockId = btn.id.replace("vto-trigger-", "");
      setupWidget(blockId, btn);
    });

    // Listen for variant changes
    listenForVariantChanges();
  }

  /**
   * Setup a single widget instance
   */
  function setupWidget(blockId, triggerBtn) {
    const modal = document.getElementById("vto-modal-" + blockId);
    if (!modal) return;

    const appUrl = triggerBtn.dataset.appUrl || "";
    const shop = triggerBtn.dataset.shop;
    let garmentImage = triggerBtn.dataset.garmentImage;
    let productId = triggerBtn.dataset.productId;
    let variantId = triggerBtn.dataset.variantId;
    let productTitle = triggerBtn.dataset.productTitle;
    let personFile = null;

    const backdrop = modal.querySelector(".vto-modal__backdrop");
    const closeBtn = modal.querySelector(".vto-modal__close");
    const fileInput = document.getElementById("vto-file-" + blockId);
    const dropzone = document.getElementById("vto-dropzone-" + blockId);
    const consentCheckbox = document.getElementById("vto-consent-" + blockId);
    const generateBtn = document.getElementById("vto-generate-" + blockId);
    const addToCartBtn = document.getElementById("vto-add-to-cart-" + blockId);
    const retryBtn = document.getElementById("vto-retry-" + blockId);
    const downloadBtn = document.getElementById("vto-download-" + blockId);
    const errorRetryBtn = document.getElementById("vto-error-retry-" + blockId);

    // Track impression
    trackEvent(appUrl, shop, "widget_impression", productId, variantId);

    // Open modal
    triggerBtn.addEventListener("click", function () {
      modal.style.display = "flex";
      document.body.style.overflow = "hidden";
      showStep(modal, "upload");
      trackEvent(appUrl, shop, "widget_open", productId, variantId);
    });

    // Close modal
    function closeModal() {
      modal.style.display = "none";
      document.body.style.overflow = "";
    }
    backdrop.addEventListener("click", closeModal);
    closeBtn.addEventListener("click", closeModal);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeModal();
    });

    // Drag & drop
    if (dropzone) {
      dropzone.addEventListener("dragover", function (e) {
        e.preventDefault();
        dropzone.classList.add("vto-upload-area--dragover");
      });
      dropzone.addEventListener("dragleave", function () {
        dropzone.classList.remove("vto-upload-area--dragover");
      });
      dropzone.addEventListener("drop", function (e) {
        e.preventDefault();
        dropzone.classList.remove("vto-upload-area--dragover");
        if (e.dataTransfer.files.length > 0) {
          handleFile(e.dataTransfer.files[0]);
        }
      });
    }

    // File input
    if (fileInput) {
      fileInput.addEventListener("change", function () {
        if (fileInput.files.length > 0) {
          handleFile(fileInput.files[0]);
        }
      });
    }

    function handleFile(file) {
      // Validate
      const validTypes = ["image/jpeg", "image/png", "image/webp"];
      if (!validTypes.includes(file.type)) {
        alert("Please upload a JPEG, PNG, or WebP image.");
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        alert("Image must be under 10MB.");
        return;
      }

      personFile = file;
      trackEvent(appUrl, shop, "photo_upload", productId, variantId);

      // Show preview
      const reader = new FileReader();
      reader.onload = function (e) {
        const personPreview = document.getElementById("vto-person-preview-" + blockId);
        if (personPreview) personPreview.src = e.target.result;
      };
      reader.readAsDataURL(file);

      const garmentPreview = document.getElementById("vto-garment-preview-" + blockId);
      if (garmentPreview && garmentImage) {
        garmentPreview.src = garmentImage;
      }

      showStep(modal, "preview");
    }

    // Generate
    if (generateBtn) {
      generateBtn.addEventListener("click", async function () {
        if (!personFile) {
          showStep(modal, "upload");
          return;
        }

        if (consentCheckbox && !consentCheckbox.checked) {
          alert("Please agree to the privacy policy to continue.");
          return;
        }

        generateBtn.disabled = true;
        showStep(modal, "processing");

        try {
          const formData = new FormData();
          formData.append("shop", shop);
          formData.append("person_image", personFile);
          formData.append("garment_image_url", garmentImage);
          formData.append("product_id", productId || "");
          formData.append("variant_id", variantId || "");
          formData.append("product_title", productTitle || "");
          formData.append("session_id", SESSION_ID);

          const response = await fetch(appUrl + "/api/tryon/generate", {
            method: "POST",
            body: formData,
          });

          const data = await response.json();

          if (data.success && data.resultImageUrl) {
            const resultImage = document.getElementById("vto-result-image-" + blockId);
            if (resultImage) resultImage.src = data.resultImageUrl;
            showStep(modal, "result");
          } else {
            const errorMsg = document.getElementById("vto-error-msg-" + blockId);
            if (errorMsg) errorMsg.textContent = data.error || "Generation failed. Please try again.";
            showStep(modal, "error");
          }
        } catch (err) {
          console.error("[VTO] Generation error:", err);
          const errorMsg = document.getElementById("vto-error-msg-" + blockId);
          if (errorMsg) errorMsg.textContent = "Network error. Please check your connection.";
          showStep(modal, "error");
        } finally {
          generateBtn.disabled = false;
        }
      });
    }

    // Add to cart
    if (addToCartBtn) {
      addToCartBtn.addEventListener("click", async function () {
        trackEvent(appUrl, shop, "add_to_cart_after_tryon", productId, variantId);

        try {
          const res = await fetch("/cart/add.js", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: variantId,
              quantity: 1,
            }),
          });

          if (res.ok) {
            addToCartBtn.textContent = "✅ Added!";
            setTimeout(function () {
              addToCartBtn.textContent = "🛒 Add to Cart";
            }, 2000);
          }
        } catch (e) {
          console.error("[VTO] Add to cart error:", e);
        }
      });
    }

    // Retry
    if (retryBtn) {
      retryBtn.addEventListener("click", function () {
        personFile = null;
        if (fileInput) fileInput.value = "";
        showStep(modal, "upload");
      });
    }

    // Error retry
    if (errorRetryBtn) {
      errorRetryBtn.addEventListener("click", function () {
        personFile = null;
        if (fileInput) fileInput.value = "";
        showStep(modal, "upload");
      });
    }

    // Download result
    if (downloadBtn) {
      downloadBtn.addEventListener("click", function () {
        const resultImage = document.getElementById("vto-result-image-" + blockId);
        if (resultImage && resultImage.src) {
          const a = document.createElement("a");
          a.href = resultImage.src;
          a.download = "virtual-tryon-" + Date.now() + ".jpg";
          a.click();
        }
      });
    }

    // Store reference for variant updates
    triggerBtn._vtoUpdate = function (newVariantId, newGarmentImage) {
      variantId = newVariantId;
      if (newGarmentImage) garmentImage = newGarmentImage;
    };
  }

  /**
   * Show a specific step in the modal
   */
  function showStep(modal, stepName) {
    const steps = modal.querySelectorAll(".vto-step");
    steps.forEach(function (step) {
      step.style.display = step.dataset.step === stepName ? "block" : "none";
    });
  }

  /**
   * Track analytics event
   */
  function trackEvent(appUrl, shop, eventType, productId, variantId) {
    if (!appUrl) return;
    try {
      fetch(appUrl + "/api/tryon/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop: shop,
          eventType: eventType,
          productId: productId || null,
          variantId: variantId || null,
          sessionId: SESSION_ID,
        }),
      }).catch(function () {
        /* silent fail for analytics */
      });
    } catch (e) {
      /* silent fail */
    }
  }

  /**
   * Listen for Shopify variant selection changes
   */
  function listenForVariantChanges() {
    // Method 1: Listen for URL changes (most themes update URL on variant change)
    let lastUrl = location.href;
    const observer = new MutationObserver(function () {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        updateVariantFromUrl();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Method 2: Listen for Shopify section rendering events
    document.addEventListener("shopify:section:load", updateVariantFromDom);

    // Method 3: Listen for variant change events (some themes dispatch these)
    document.addEventListener("variant:changed", function (e) {
      if (e.detail && e.detail.variant) {
        updateAllButtons(e.detail.variant.id, e.detail.variant.featured_image?.src);
      }
    });
  }

  function updateVariantFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const variantId = params.get("variant");
    if (variantId) {
      updateAllButtons(variantId, null);
    }
  }

  function updateVariantFromDom() {
    // Try to find selected variant from product form
    const form = document.querySelector("form[action*='/cart/add']");
    if (form) {
      const variantInput = form.querySelector("input[name='id']");
      if (variantInput) {
        updateAllButtons(variantInput.value, null);
      }
    }
  }

  function updateAllButtons(newVariantId, newGarmentImage) {
    const buttons = document.querySelectorAll("[id^='vto-trigger-']");
    buttons.forEach(function (btn) {
      if (btn._vtoUpdate) {
        btn._vtoUpdate(newVariantId, newGarmentImage);
      }
      btn.dataset.variantId = newVariantId;
    });
  }

  // Initialize when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
