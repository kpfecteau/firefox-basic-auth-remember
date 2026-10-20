// Loaded after popup.js for popup screenshots: turns the popup page itself
// into a 1280x800 frame by moving its content into a scaled card and adding a
// short caption beside it (styles in stage.css). Everything stays in one
// document, so no cross-frame access is needed. The scene (#answer, #locked)
// picks the caption.
const CAPTIONS = {
  answer: [
    "Signs in for you",
    "Save a login once. Next time the site asks, it’s answered and the login dialog never appears.",
  ],
  locked: [
    "Encrypted until you unlock",
    "Logins are encrypted under your passphrase. Unlock once each time Firefox starts.",
  ],
};

const link = document.createElement("link");
link.rel = "stylesheet";
link.href = "stage.css";
document.head.append(link);

const card = document.createElement("div");
card.className = "stage-card";
card.append(...[...document.body.children].filter((el) => el.tagName !== "SCRIPT"));

const caption = document.createElement("div");
caption.className = "stage-caption";
const [title, text] = CAPTIONS[location.hash.slice(1)] || CAPTIONS.answer;
const h = document.createElement("h2");
h.textContent = title;
const p = document.createElement("p");
p.textContent = text;
caption.append(h, p);

document.body.classList.add("stage");
document.body.prepend(card, caption);
document.activeElement?.blur();
