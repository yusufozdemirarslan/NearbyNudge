import * as React from "react"
import { useAccount } from "@/hooks/use-account"
import type { Preferences } from "@/lib/api/types"

const STORAGE_KEY = "nn-theme"
const DARK_QUERY = "(prefers-color-scheme: dark)"

/** Applies a theme now: adds or removes `.dark` on <html>. */
export function applyTheme(theme: Preferences["theme"]) {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia(DARK_QUERY).matches)
  document.documentElement.classList.toggle("dark", dark)
  document.documentElement.style.colorScheme = dark ? "dark" : "light"
  try {
    window.localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // storage blocked; the theme still applies for this visit
  }
}

function storedTheme(): Preferences["theme"] {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return value === "light" || value === "dark" ? value : "system"
  } catch {
    return "system"
  }
}

/**
 * Keeps <html class="dark"> in line with Preferences.theme ("system" follows
 * the OS and updates live). Before the account loads it uses the last theme
 * this browser saw (public/theme-init.js applied it before first paint).
 */
export function ThemeSync() {
  const { data } = useAccount()
  const theme = data?.preferences.theme ?? storedTheme()

  React.useEffect(() => {
    applyTheme(theme)
    if (theme !== "system") return
    const list = window.matchMedia(DARK_QUERY)
    const onChange = () => applyTheme("system")
    list.addEventListener("change", onChange)
    return () => list.removeEventListener("change", onChange)
  }, [theme])

  return null
}
