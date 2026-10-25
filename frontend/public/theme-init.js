// Sets the .dark class on <html> before React loads, so the page never flashes
// the wrong theme. The app keeps "nn-theme" in sync with Preferences.theme.
;(function () {
  try {
    var saved = window.localStorage.getItem("nn-theme")
    var theme = saved === "light" || saved === "dark" ? saved : "system"
    var dark =
      theme === "dark" ||
      (theme === "system" &&
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches)
    if (dark) document.documentElement.classList.add("dark")
  } catch (e) {
    // Storage can be blocked; the app applies the theme once it loads.
  }
})()
