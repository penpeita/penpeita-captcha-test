"use strict";

async function decryptConfig(envelope, password, subtle = globalThis.crypto?.subtle) {
  if (!subtle) throw new Error("このブラウザーでは利用できません。HTTPSのページをChromeなどで開いてください。");
  if (!envelope || envelope.version !== 1) throw new Error("テストページは準備中です。");
  if (typeof password !== "string" || password.length > 1024) throw new Error("パスワードを確認してください。");
  const decode = (value) => {
    if (typeof value !== "string" || value.length > 100000) throw new Error("Invalid envelope");
    return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  };
  const salt = decode(envelope.salt);
  const iv = decode(envelope.iv);
  const data = decode(envelope.data);
  if (salt.length !== 16 || iv.length !== 12 || data.length < 16) throw new Error("Invalid envelope");
  const material = await subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await subtle.deriveKey({ name: "PBKDF2", salt, iterations: 600000, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const plaintext = await subtle.decrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode("penpeita-captcha-test:v1"), tagLength: 128 }, key, data);
  const config = JSON.parse(new TextDecoder().decode(plaintext));
  if (!config || typeof config.integrationUrl !== "string" || typeof config.apiKey !== "string") throw new Error("Invalid configuration");
  return { integrationUrl: config.integrationUrl, apiKey: config.apiKey };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { decryptConfig };
} else {
  const form = document.getElementById("unlock-form");
  const input = document.getElementById("access-password");
  const button = document.getElementById("unlock-button");
  const message = document.getElementById("unlock-status");
  let busy = false;
  let appLoaded = false;
  const loadApp = () => new Promise((resolve, reject) => {
    if (appLoaded) return resolve();
    const script = document.createElement("script");
    script.src = "./app.js";
    script.onload = () => { appLoaded = true; resolve(); };
    script.onerror = () => { script.remove(); reject(new Error("Page load failed")); };
    document.head.append(script);
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    button.disabled = true;
    message.textContent = "パスワードを確認しています…";
    try {
      window.CAPTCHA_TEST_CONFIG = await decryptConfig(window.CAPTCHA_TEST_ENCRYPTED_CONFIG, input.value.trim());
      await loadApp();
      input.value = "";
      document.getElementById("access-gate").hidden = true;
      document.getElementById("test-content").hidden = false;
      document.getElementById("start").focus();
      if (window.CAPTCHA_TEST_CONFIG.integrationUrl && window.CAPTCHA_TEST_CONFIG.apiKey) {
        document.getElementById("start").click();
      }
    } catch {
      delete window.CAPTCHA_TEST_CONFIG;
      message.textContent = "開けませんでした。パスワード全文を貼り付け直してください。改善しない場合はページを再読み込みしてください。";
      input.focus();
    } finally {
      busy = false;
      button.disabled = false;
    }
  });
  // Never persist the password, decrypted configuration, or unlock status.
  window.addEventListener("pageshow", (event) => { if (event.persisted) location.reload(); });
}
