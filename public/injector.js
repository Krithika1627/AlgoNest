const ALGONEST_SOURCE = "algonest";

const postPayload = (payload) => {
  try {
    window.postMessage({ source: ALGONEST_SOURCE, type: "GRAPHQL_RESPONSE", payload }, "*");
  } catch {
    // ignore
  }
};

const originalFetch = window.fetch;
window.fetch = async (...args) => {
  const response = await originalFetch(...args);
  try {
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
    if (url && (url.includes("/graphql") || url.includes("/check/"))) {
      response.clone().json().then(postPayload).catch(() => null);
    }
  } catch {
    // ignore
  }
  return response;
};

const originalOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function open(...args) {
  this._algonestUrl = String(args[1] ?? "");
  return originalOpen.apply(this, args);
};

const originalSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send = function send(...args) {
  this.addEventListener("load", () => {
    try {
      const url = String(this._algonestUrl ?? "");
        if (url && (url.includes("/graphql") || url.includes("/check/"))) {
        postPayload(JSON.parse(this.responseText));
      }
    } catch {
      // ignore
    }
  });
  return originalSend.apply(this, args);
};

// Capture code from Monaco at submit time and post to content script
function getCodeFromMonaco() {
  try {
    const models = window.monaco?.editor?.getModels?.();
    if (models?.length) {
      const codeModels = models.filter(m => {
        const lang = m.getLanguageId?.() ?? "";
        return lang !== "markdown" && lang !== "plaintext" && lang !== "text";
      });
      if (codeModels.length) {
        const model = codeModels.reduce((a, b) =>
          a.getValue().length > b.getValue().length ? a : b
        );
        const val = model.getValue();
        if (val.trim().length > 0) return val;
      }
    }
  } catch { /* fall through */ }
  return null;
}

// Intercept submit button clicks
document.addEventListener("click", (event) => {
  const button = event.target?.closest("button, [role='button']");
  if (!button) return;
  const text = button.textContent?.trim().toLowerCase() ?? "";
  if (text.includes("run") && !text.includes("submit")) return;
  const isSubmit =
    button.getAttribute("data-cy") === "submit-code-btn" ||
    button.getAttribute("data-e2e-locator") === "console-submit-button" ||
    text === "submit" ||
    text.includes("submit");
  if (!isSubmit) return;

  const code = getCodeFromMonaco();
  if (code) {
    window.postMessage({
      source: "algonest",
      type: "CODE_CAPTURED",
      payload: { code }
    }, "*");
  }
}, { capture: true });
