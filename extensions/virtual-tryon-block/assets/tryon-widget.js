/**
 * Virtual Try-On Widget — Storefront JavaScript
 * Handles upload + camera capture → preview → generate → result
 */
(function () {
  "use strict";

  var SESSION_ID = "vto_" + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);

  // ── Initialise ──
  function init() {
    var buttons = document.querySelectorAll("[id^='vto-trigger-']");
    buttons.forEach(function (btn) {
      var blockId = btn.id.replace("vto-trigger-", "");
      setupWidget(blockId, btn);
    });
    listenForVariantChanges();
  }

  // ── Widget instance ──
  function setupWidget(blockId, triggerBtn) {
    var modal = document.getElementById("vto-modal-" + blockId);
    if (!modal) return;

    var appUrl = triggerBtn.dataset.appUrl || "";
    var shop = triggerBtn.dataset.shop;
    var garmentImage = triggerBtn.dataset.garmentImage;
    var productId = triggerBtn.dataset.productId;
    var variantId = triggerBtn.dataset.variantId;
    var productTitle = triggerBtn.dataset.productTitle;
    var personFile = null;

    // Elements
    var backdrop = modal.querySelector(".vto-modal__backdrop");
    var closeBtn = modal.querySelector(".vto-modal__close");
    var fileInput = document.getElementById("vto-file-" + blockId);
    var dropzone = document.getElementById("vto-dropzone-" + blockId);
    var consentCheckbox = document.getElementById("vto-consent-" + blockId);
    var generateBtn = document.getElementById("vto-generate-" + blockId);
    var addToCartBtn = document.getElementById("vto-add-to-cart-" + blockId);
    var retryBtn = document.getElementById("vto-retry-" + blockId);
    var downloadBtn = document.getElementById("vto-download-" + blockId);
    var errorRetryBtn = document.getElementById("vto-error-retry-" + blockId);
    var changePhotoBtn = document.getElementById("vto-change-photo-" + blockId);

    // Method cards
    var methodUpload = document.getElementById("vto-method-upload-" + blockId);
    var methodCamera = document.getElementById("vto-method-camera-" + blockId);

    // Camera elements
    var cameraVideo = document.getElementById("vto-camera-video-" + blockId);
    var cameraCanvas = document.getElementById("vto-camera-canvas-" + blockId);
    var cameraCaptureBtn = document.getElementById("vto-camera-capture-" + blockId);
    var cameraBackBtn = document.getElementById("vto-camera-back-" + blockId);
    var cameraFlipBtn = document.getElementById("vto-camera-flip-" + blockId);

    var cameraStream = null;
    var facingMode = "user"; // front camera by default

    // Track impression
    trackEvent(appUrl, shop, "widget_impression", productId, variantId);

    // ── Open / Close modal ──
    triggerBtn.addEventListener("click", function () {
      modal.style.display = "flex";
      document.body.style.overflow = "hidden";
      showStep(modal, "upload");
      trackEvent(appUrl, shop, "widget_open", productId, variantId);
    });

    function closeModal() {
      modal.style.display = "none";
      document.body.style.overflow = "";
      stopCamera();
    }
    backdrop.addEventListener("click", closeModal);
    closeBtn.addEventListener("click", closeModal);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeModal();
    });

    // ── Method: Upload photo ──
    if (methodUpload) {
      methodUpload.addEventListener("click", function () {
        fileInput.click();
      });
    }

    if (fileInput) {
      fileInput.addEventListener("change", function () {
        if (fileInput.files.length > 0) handleFile(fileInput.files[0]);
      });
    }

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
        if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
      });
    }

    // ── Method: Camera ──
    if (methodCamera) {
      methodCamera.addEventListener("click", function () {
        startCamera();
      });
    }

    function startCamera() {
      showStep(modal, "camera");
      var constraints = {
        video: {
          facingMode: facingMode,
          width: { ideal: 1080 },
          height: { ideal: 1440 },
        },
        audio: false,
      };

      navigator.mediaDevices
        .getUserMedia(constraints)
        .then(function (stream) {
          cameraStream = stream;
          cameraVideo.srcObject = stream;
          cameraVideo.play();
        })
        .catch(function (err) {
          console.warn("[VTO] Camera error:", err);
          // Fallback: show file picker with camera capture
          if (fileInput) {
            fileInput.setAttribute("capture", "environment");
            fileInput.click();
          }
          showStep(modal, "upload");
        });
    }

    function stopCamera() {
      if (cameraStream) {
        cameraStream.getTracks().forEach(function (track) {
          track.stop();
        });
        cameraStream = null;
      }
      if (cameraVideo) cameraVideo.srcObject = null;
    }

    // Capture photo from camera
    if (cameraCaptureBtn) {
      cameraCaptureBtn.addEventListener("click", function () {
        if (!cameraVideo || !cameraCanvas) return;

        var w = cameraVideo.videoWidth;
        var h = cameraVideo.videoHeight;
        cameraCanvas.width = w;
        cameraCanvas.height = h;

        var ctx = cameraCanvas.getContext("2d");

        // Mirror if using front camera
        if (facingMode === "user") {
          ctx.translate(w, 0);
          ctx.scale(-1, 1);
        }

        ctx.drawImage(cameraVideo, 0, 0, w, h);

        // Add subtle flash effect
        cameraCaptureBtn.style.opacity = "0.5";
        setTimeout(function () {
          cameraCaptureBtn.style.opacity = "1";
        }, 150);

        cameraCanvas.toBlob(
          function (blob) {
            if (!blob) return;
            var file = new File([blob], "camera-photo-" + Date.now() + ".jpg", {
              type: "image/jpeg",
            });
            stopCamera();
            handleFile(file);
          },
          "image/jpeg",
          0.92
        );
      });
    }

    // Camera back button
    if (cameraBackBtn) {
      cameraBackBtn.addEventListener("click", function () {
        stopCamera();
        showStep(modal, "upload");
      });
    }

    // Flip camera
    if (cameraFlipBtn) {
      cameraFlipBtn.addEventListener("click", function () {
        facingMode = facingMode === "user" ? "environment" : "user";
        stopCamera();
        startCamera();
      });
    }

    // ── Handle file (from upload or camera) ──
    function handleFile(file) {
      var validTypes = ["image/jpeg", "image/png", "image/webp"];
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
      var reader = new FileReader();
      reader.onload = function (e) {
        var personPreview = document.getElementById("vto-person-preview-" + blockId);
        if (personPreview) personPreview.src = e.target.result;
      };
      reader.readAsDataURL(file);

      var garmentPreview = document.getElementById("vto-garment-preview-" + blockId);
      if (garmentPreview && garmentImage) garmentPreview.src = garmentImage;

      showStep(modal, "preview");
    }

    // ── Change photo ──
    if (changePhotoBtn) {
      changePhotoBtn.addEventListener("click", function () {
        personFile = null;
        if (fileInput) fileInput.value = "";
        showStep(modal, "upload");
      });
    }

    // ── Generate ──
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
          var formData = new FormData();
          formData.append("shop", shop);
          formData.append("person_image", personFile);
          formData.append("garment_image_url", garmentImage);
          formData.append("product_id", productId || "");
          formData.append("variant_id", variantId || "");
          formData.append("product_title", productTitle || "");
          formData.append("session_id", SESSION_ID);

          var response = await fetch(appUrl + "/api/tryon/generate", {
            method: "POST",
            body: formData,
          });
          var data = await response.json();

          if (data.success && data.resultImageUrl) {
            var resultImage = document.getElementById("vto-result-image-" + blockId);
            if (resultImage) resultImage.src = data.resultImageUrl;
            showStep(modal, "result");
          } else {
            var errorMsg = document.getElementById("vto-error-msg-" + blockId);
            if (errorMsg) errorMsg.textContent = data.error || "Generation failed. Please try again.";
            showStep(modal, "error");
          }
        } catch (err) {
          console.error("[VTO] Generation error:", err);
          var errorMsg2 = document.getElementById("vto-error-msg-" + blockId);
          if (errorMsg2) errorMsg2.textContent = "Network error. Please check your connection.";
          showStep(modal, "error");
        } finally {
          generateBtn.disabled = false;
        }
      });
    }

    // ── Add to cart ──
    if (addToCartBtn) {
      addToCartBtn.addEventListener("click", async function () {
        trackEvent(appUrl, shop, "add_to_cart_after_tryon", productId, variantId);
        try {
          var res = await fetch("/cart/add.js", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: variantId, quantity: 1 }),
          });
          if (res.ok) {
            var btnSpan = addToCartBtn.querySelector("span");
            var origText = btnSpan ? btnSpan.textContent : "";
            if (btnSpan) btnSpan.textContent = "Added!";
            addToCartBtn.style.background = "#10b981";
            setTimeout(function () {
              if (btnSpan) btnSpan.textContent = origText;
              addToCartBtn.style.background = "";
            }, 2000);
          }
        } catch (e) {
          console.error("[VTO] Add to cart error:", e);
        }
      });
    }

    // ── Retry ──
    if (retryBtn) {
      retryBtn.addEventListener("click", function () {
        personFile = null;
        if (fileInput) fileInput.value = "";
        showStep(modal, "upload");
      });
    }
    if (errorRetryBtn) {
      errorRetryBtn.addEventListener("click", function () {
        personFile = null;
        if (fileInput) fileInput.value = "";
        showStep(modal, "upload");
      });
    }

    // ── Download ──
    if (downloadBtn) {
      downloadBtn.addEventListener("click", function () {
        var resultImage = document.getElementById("vto-result-image-" + blockId);
        if (resultImage && resultImage.src) {
          var a = document.createElement("a");
          a.href = resultImage.src;
          a.download = "virtual-tryon-" + Date.now() + ".jpg";
          a.click();
        }
      });
    }

    // Store update ref
    triggerBtn._vtoUpdate = function (newVariantId, newGarmentImage) {
      variantId = newVariantId;
      if (newGarmentImage) garmentImage = newGarmentImage;
    };
  }

  // ── Step navigation ──
  function showStep(modal, stepName) {
    var steps = modal.querySelectorAll(".vto-step");
    steps.forEach(function (step) {
      step.style.display = step.dataset.step === stepName ? "block" : "none";
    });
  }

  // ── Analytics ──
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
      }).catch(function () {});
    } catch (e) {}
  }

  // ── Variant listener ──
  function listenForVariantChanges() {
    var lastUrl = location.href;
    var observer = new MutationObserver(function () {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        var params = new URLSearchParams(window.location.search);
        var vid = params.get("variant");
        if (vid) updateAllButtons(vid, null);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    document.addEventListener("shopify:section:load", function () {
      var form = document.querySelector("form[action*='/cart/add']");
      if (form) {
        var input = form.querySelector("input[name='id']");
        if (input) updateAllButtons(input.value, null);
      }
    });

    document.addEventListener("variant:changed", function (e) {
      if (e.detail && e.detail.variant) {
        updateAllButtons(e.detail.variant.id, e.detail.variant.featured_image?.src);
      }
    });
  }

  function updateAllButtons(newVariantId, newGarmentImage) {
    var buttons = document.querySelectorAll("[id^='vto-trigger-']");
    buttons.forEach(function (btn) {
      if (btn._vtoUpdate) btn._vtoUpdate(newVariantId, newGarmentImage);
      btn.dataset.variantId = newVariantId;
    });
  }

  // Boot
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
