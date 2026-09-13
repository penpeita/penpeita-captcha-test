(() => {
  "use strict";
  const el = (id) => document.getElementById(id);
  const button = el("start");
  const settings = el("settings");
  const urlInput = el("integration-url");
  const keyInput = el("api-key");
  const container = el("captcha");
  let attempt = 0;
  let state = "idle";
  let completedAt = null;
  let scriptPromise = null;
  let configuration = null;
  let puzzleTimer;

  function status(next, label, title, detail) {
    state = next;
    el("result").dataset.state = next;
    el("status-label").textContent = label;
    el("status-title").textContent = title;
    el("status-detail").textContent = detail;
  }

  function fail(message) {
    clearTimeout(puzzleTimer);
    attempt += 1; // Ignore callbacks belonging to the failed puzzle.
    completedAt = null;
    container.hidden = true;
    container.replaceChildren();
    button.disabled = false;
    button.textContent = "もう一度試す";
    status("error", "エラー", "CAPTCHAを開始できませんでした", message);
  }

  function readConfiguration() {
    if (location.protocol !== "https:") {
      throw new Error("実物のCAPTCHAはHTTPSのページで実行してください。ローカルでは画面の確認のみできます。");
    }
    let url;
    try { url = new URL(urlInput.value.trim()); } catch {
      throw new Error("AWS WAFからコピーしたJavaScript連携URLを入力してください。");
    }
    // Restrict executable configuration to AWS-owned integration scripts.
    if (url.protocol !== "https:" || !url.hostname.endsWith(".awswaf.com") ||
        url.username || url.password || url.port || url.search || url.hash ||
        !url.pathname.endsWith("/jsapi.js")) {
      throw new Error("連携URLは https:// で始まるAWS WAFのURL（*.awswaf.com、末尾 /jsapi.js）を指定してください。");
    }
    const apiKey = keyInput.value.trim();
    if (!apiKey) throw new Error("このページのドメイン用に発行したCAPTCHA APIキーを入力してください。");
    return { integrationUrl: url.href, apiKey };
  }

  function loadSdk() {
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        script.onload = null;
        script.onerror = null;
        if (error) { script.remove(); reject(error); } else { resolve(); }
      };
      const timer = setTimeout(() => finish(new Error("AWSへの接続がタイムアウトしました。ページを再読み込みし、通信状態と連携URLを確認してください。")), 20000);
      script.src = configuration.integrationUrl;
      script.async = true;
      script.onload = () => finish(typeof window.AwsWafCaptcha?.renderCaptcha === "function" ? null : new Error("CAPTCHA用のAPIが見つかりません。連携URLを確認してページを再読み込みしてください。"));
      script.onerror = () => finish(new Error("AWSのスクリプトを読み込めません。連携URL・通信状態・ブラウザーの制限を確認してページを再読み込みしてください。"));
      // The Web ACL token domain list and encrypted API key must also allow this host.
      window.awsWafCookieDomainList = [location.hostname];
      document.head.append(script);
    });
    return scriptPromise;
  }

  async function start() {
    if (button.disabled) return;
    completedAt = null;
    const current = ++attempt;
    try {
      configuration = configuration || readConfiguration();
      urlInput.disabled = keyInput.disabled = true;
      el("settings-help").textContent = "接続設定を変更する場合はページを再読み込みしてください。CAPTCHA APIキー以外のAWS認証情報は入力しないでください。";
      settings.open = false;
      button.disabled = true;
      button.textContent = "読み込み中…";
      status("loading", "接続中", "CAPTCHAを読み込んでいます", "AWSへの接続をお待ちください。");
      await loadSdk();
      if (current !== attempt) return;
      const puzzle = document.createElement("div");
      container.replaceChildren(puzzle);
      container.hidden = false;
      const active = () => current === attempt;
      const ready = () => {
        if (!active()) return;
        clearTimeout(puzzleTimer);
        button.disabled = false;
        button.textContent = "新しいパズルにする";
        status("ready", "回答待ち", "パズルを解いてください", "画面の指示に従って回答してください。");
      };
      puzzleTimer = setTimeout(() => {
        if (active()) fail("パズルが届きませんでした。APIキーの対象ドメインと、AWS WAFのトークンドメイン設定を確認してください。");
      }, 30000);
      window.AwsWafCaptcha.renderCaptcha(puzzle, {
        apiKey: configuration.apiKey,
        defaultLocale: "ja-JP",
        dynamicWidth: true,
        onLoad: ready,
        onPuzzleCorrect: () => {
          if (!active()) return;
          clearTimeout(puzzleTimer);
          puzzleTimer = setTimeout(() => { if (active()) fail("AWSから完了通知が届きませんでした。通信状態を確認して再挑戦してください。"); }, 30000);
          status("verifying", "確認中", "回答を確認しています", "AWSからの完了通知をお待ちください。");
        },
        onPuzzleIncorrect: () => {
          if (active()) status("incorrect", "再回答", "もう一度お試しください", "回答が一致しませんでした。パズルの指示を確認してください。");
        },
        onPuzzleTimeout: () => {
          if (!active()) return;
          clearTimeout(puzzleTimer);
          attempt += 1;
          container.hidden = true;
          container.replaceChildren();
          button.disabled = false;
          button.textContent = "新しいパズルにする";
          status("expired", "時間切れ", "パズルの有効期限が切れました", "新しいパズルを表示して再挑戦してください。");
        },
        onError: (error) => {
          if (!active()) return;
          const messages = {
            network_error: "AWSとの通信に失敗しました。通信状態を確認して再挑戦してください。",
            token_error: "トークンを取得できません。対象ドメイン・APIキー・Cookieの許可を確認してください。",
            client_error: "接続設定を確認してください。APIキーとWeb ACLで、このドメインを許可する必要があります。"
          };
          fail(messages[error?.kind] || "AWSでエラーが発生しました。時間をおいて再挑戦してください。");
        },
        onSuccess: (token) => {
          if (!active()) return;
          if (typeof token !== "string" || !token.trim()) { fail("AWSから有効な完了通知を受け取れませんでした。"); return; }
          clearTimeout(puzzleTimer);
          attempt += 1;
          completedAt = new Date().toISOString();
          // Do not display, log, persist, or send the token to another service.
          container.hidden = true;
          container.replaceChildren();
          button.disabled = false;
          button.textContent = "もう一度テストする";
          status("success", "完了", "成功", "AWS WAF CAPTCHAの完了を確認しました。");
          el("status-title").setAttribute("tabindex", "-1");
          el("status-title").focus();
        }
      });
    } catch (error) {
      if (current === attempt) fail(error instanceof Error ? error.message : "CAPTCHAを開始できませんでした。");
    }
  }

  const defaults = window.CAPTCHA_TEST_CONFIG || {};
  urlInput.value = typeof defaults.integrationUrl === "string" ? defaults.integrationUrl : "";
  keyInput.value = typeof defaults.apiKey === "string" ? defaults.apiKey : "";
  el("current-domain").textContent = location.hostname || "ローカルファイル";
  if (urlInput.value && keyInput.value) {
    settings.open = false;
    el("status-detail").textContent = "ボタンを押すとAWS WAF CAPTCHAが表示されます。";
  }
  button.addEventListener("click", start);

  // Optional read-only integration: agents can inspect completion, never force it.
  if (document.modelContext?.registerTool) {
    const lifecycle = new AbortController();
    window.addEventListener("pagehide", () => lifecycle.abort(), { once: true });
    try {
      Promise.resolve(document.modelContext.registerTool({
        name: "read_captcha_test_status",
        description: "Read the visible CAPTCHA test status. Does not solve or start a CAPTCHA and never returns a token.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute(input) {
          if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length) throw new Error("Expected an empty object.");
          return { state, completedAt };
        }
      }, { signal: lifecycle.signal })).catch(() => {});
    } catch { /* Unsupported experimental browser API must not break the page. */ }
  }
})();
