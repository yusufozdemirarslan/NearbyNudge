import * as React from "react"
import { CheckIcon } from "lucide-react"
import { CalmError } from "@/components/CalmError"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Switch } from "@/components/ui/switch"
import { useAnnounce } from "@/hooks/use-announce"
import { useUpdatePreferences } from "@/hooks/use-account"
import type { Preferences } from "@/lib/api/types"
import { Section } from "./form-kit"

type SwitchKey = "shortcuts_enabled" | "webmail_mode" | "compact_rows" | "live_updates"

const SWITCHES: { key: SwitchKey; label: string; description: string }[] = [
  {
    key: "shortcuts_enabled",
    label: "Single-key shortcuts",
    description:
      "A approves, J and K move between leads, and so on. They never fire while you type. Turn them off if you use speech input or they get in the way.",
  },
  {
    key: "webmail_mode",
    label: "I use Gmail or Outlook in the browser: make Copy the main button",
    description:
      "Email links can't always open webmail, so Copy email becomes the main send button.",
  },
  {
    key: "compact_rows",
    label: "Compact rows",
    description: "Lead lists use 32-pixel rows instead of 40, so more fit on the screen.",
  },
  {
    key: "live_updates",
    label: "Live updates",
    description:
      "New leads and research progress appear on their own. Turn it off to keep the screen still while you read.",
  },
]

const THEMES: { value: Preferences["theme"]; label: string }[] = [
  { value: "system", label: "Match my computer" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
]

/** Preferences save as soon as they change (PUT /api/account/preferences). */
export function PreferencesSection({ preferences }: { preferences: Preferences }) {
  const update = useUpdatePreferences()
  const announce = useAnnounce()
  const ids = React.useId()
  const [state, setState] = React.useState<{ status: "idle" | "saving" | "saved" | "error"; error?: unknown }>({
    status: "idle",
  })
  const lastPatch = React.useRef<Partial<Preferences> | null>(null)

  const save = async (patch: Partial<Preferences>) => {
    lastPatch.current = patch
    setState({ status: "saving" })
    try {
      await update(patch)
      setState({ status: "saved" })
      announce("Preferences saved")
    } catch (error) {
      setState({ status: "error", error })
    }
  }

  return (
    <Section
      id="preferences"
      title="Preferences"
      description="Changes save as soon as you make them and apply wherever NearbyNudge is open."
      actions={
        state.status === "saved" ? (
          <span className="inline-flex items-center gap-1.5 text-ui text-success">
            <CheckIcon aria-hidden="true" className="size-4" />
            Saved
          </span>
        ) : state.status === "saving" ? (
          <span className="text-ui text-ink-secondary">Saving…</span>
        ) : null
      }
    >
      <div className="flex flex-col">
        {SWITCHES.map((item) => {
          const id = `${ids}-${item.key}`
          return (
            <div key={item.key} className="flex items-start justify-between gap-6 border-b py-4 first:pt-0">
              <div className="min-w-0 space-y-1">
                <label htmlFor={id} className="block cursor-pointer text-ui font-medium text-foreground">
                  {item.label}
                </label>
                <p id={`${id}-hint`} className="max-w-[60ch] text-ui text-ink-secondary">
                  {item.description}
                </p>
              </div>
              <Switch
                id={id}
                aria-describedby={`${id}-hint`}
                checked={preferences[item.key]}
                onCheckedChange={(checked) => void save({ [item.key]: checked })}
                className="mt-0.5"
              />
            </div>
          )
        })}

        <fieldset className="mt-4">
          <legend id={`${ids}-theme`} className="text-ui font-medium text-foreground">
            Theme
          </legend>
          <p id={`${ids}-theme-hint`} className="mt-1 mb-3 text-ui text-ink-secondary">
            Match my computer follows your system setting for light or dark.
          </p>
          <RadioGroup
            value={preferences.theme}
            onValueChange={(value) => void save({ theme: value as Preferences["theme"] })}
            aria-labelledby={`${ids}-theme`}
            aria-describedby={`${ids}-theme-hint`}
            className="flex flex-wrap gap-2"
          >
            {THEMES.map((theme) => (
              <label
                key={theme.value}
                className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-lg border border-[color-mix(in_srgb,var(--input)_55%,transparent)] bg-card px-3 py-2 text-ui font-medium text-foreground transition-colors hover:bg-muted has-data-checked:border-primary has-data-checked:bg-accent"
              >
                <RadioGroupItem value={theme.value} />
                {theme.label}
              </label>
            ))}
          </RadioGroup>
        </fieldset>
      </div>

      {state.status === "error" && (
        <CalmError
          size="inline"
          className="mt-5"
          title="We couldn't save that change"
          error={state.error}
          onRetry={() => lastPatch.current && void save(lastPatch.current)}
        />
      )}
    </Section>
  )
}
