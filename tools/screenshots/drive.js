// Loaded after options.js in every options-page screenshot.

// Screenshots shouldn't show the page's scrollbar strip.
document.documentElement.style.scrollbarWidth = "none";

// #edit scene: opens a login in edit mode and runs "Test a host", so the
// screenshot shows the page in use. Waits on promises only (no timers), so it
// finishes before the headless screenshot is taken.

(async () => {
  if (location.hash !== "#edit") return;
  for (let i = 0; i < 200 && !document.querySelector("#rows tr[data-pattern]"); i++) {
    await Promise.resolve();
  }
  const row = document.querySelector('#rows tr[data-pattern="staging.example.com:8443"]');
  row.querySelector("button").click();
  document.getElementById("test-host").value = "review-142.example.com";
  document.getElementById("test-form").requestSubmit();
  document.activeElement.blur();
})();
