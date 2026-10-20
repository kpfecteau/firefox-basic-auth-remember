// Fake WebExtension APIs so popup.html and options.html render outside the
// extension for store screenshots (see run.sh). The scene comes from the URL
// hash: #answer, #locked (popup), #logins, #edit (options page).
// All hosts use example.com.
const scene = location.hash.slice(1) || "answer";
const saved = {
  "*.dev.example.com": { username: "deploy", password: "correct-horse-battery" },
  "staging.example.com:8443": { username: "qa-team", password: "staple-lamp-river" },
  "/^review-\\d+\\.example\\.com$/": { username: "reviewer", password: "pr-preview-pass" },
  "localhost:3000": { username: "admin", password: "local-dev-only" },
};
const state = scene === "locked" ? "locked" : "unlocked";

window.browser = {
  tabs: {
    query: async () => [{ url: "https://app.dev.example.com/dashboard", lastAccessed: 1, active: true }],
  },
  extension: { isAllowedIncognitoAccess: async () => true },
  runtime: {
    sendMessage: async (m) => {
      if (m.type === "status") return { state, legacyCount: 0 };
      if (m.type === "list") return saved;
      return undefined;
    },
    onMessage: { addListener() {} },
    openOptionsPage() {},
  },
};
