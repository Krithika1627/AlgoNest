const ALGONEST_SOURCE = "algonest";
console.log("🔥 INJECTOR LOADED");
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
      if (this._algonestUrl && String(this._algonestUrl).includes("/graphql")) {
        postPayload(JSON.parse(this.responseText));
      }
    } catch {
      // ignore
    }
  });
  return originalSend.apply(this, args);
};
