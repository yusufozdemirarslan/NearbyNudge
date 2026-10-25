import * as React from "react"
import { CircleAlertIcon } from "lucide-react"
import type { FieldValues, Path, UseFormSetError, UseFormSetFocus } from "react-hook-form"
import { isApiError } from "@/lib/api"
import { cn } from "@/lib/utils"

/*
 * Small form and layout helpers shared by the FE-B screens (auth, onboarding,
 * settings, new campaign, do-not-contact, admin, public opt-out). They wire
 * labels, hints and errors the same way everywhere (WCAG 1.3.1, 3.3.1, 3.3.2):
 * every control has a visible label, its hint and error are linked with
 * aria-describedby, and invalid controls carry aria-invalid.
 */

/** Props a FormField hands to its control. Spread them on the input. */
export interface ControlProps {
  id: string
  "aria-describedby"?: string
  "aria-invalid"?: true
  "aria-required"?: true
}

export interface FormFieldProps {
  /** Visible label (also the accessible name). */
  label: React.ReactNode
  /** One plain hint, shown between the label and the control. */
  description?: React.ReactNode
  /** Error message for this field, shown under the control. */
  error?: string
  /** Adds "(optional)" after the label. */
  optional?: boolean
  /** Marks the control aria-required (the form uses noValidate). */
  required?: boolean
  /** Keeps the label for screen readers only. Use sparingly. */
  hideLabel?: boolean
  /** Fixed id for the control; one is generated otherwise. */
  id?: string
  className?: string
  /** Extra content after the control (suggestion chips, a counter). */
  after?: React.ReactNode
  children: (control: ControlProps) => React.ReactNode
}

/** Label, hint, control and error, linked for assistive technology. */
export function FormField({
  label,
  description,
  error,
  optional,
  required,
  hideLabel,
  id: fixedId,
  className,
  after,
  children,
}: FormFieldProps) {
  const generated = React.useId()
  const id = fixedId ?? `f${generated.replace(/:/gu, "")}`
  const hintId = description ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined
  return (
    <div data-slot="form-field" className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className={cn("w-fit text-ui font-medium text-foreground", hideLabel && "sr-only")}>
        {label}
        {optional && <span className="font-normal text-muted-foreground"> (optional)</span>}
      </label>
      {description && (
        <p id={hintId} className="max-w-[68ch] text-ui text-ink-secondary">
          {description}
        </p>
      )}
      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
        "aria-required": required ? true : undefined,
      })}
      {after}
      {error && <FieldMessage id={errorId}>{error}</FieldMessage>}
    </div>
  )
}

/** An error line for a field or a group of fields (icon + words, not color alone). */
export function FieldMessage({ id, children, className }: { id?: string; children: React.ReactNode; className?: string }) {
  return (
    <p id={id} data-slot="field-message" className={cn("flex items-start gap-1.5 text-ui text-destructive", className)}>
      <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

/** Standard input sizing on our type scale (36 px tall, 16 px text on phones so iOS doesn't zoom). */
export const inputClass = "h-9 text-base md:text-ui"

/** The backend's message when several fields failed schema validation. */
const GENERIC_VALIDATION_MESSAGE = "Please check the highlighted fields."

/**
 * Per-field messages from an API error (`error.fields`), with an optional
 * prefix stripped ("input.location" -> "location"). When exactly one field
 * failed, the backend's main message is the specific sentence ("Type delete
 * to confirm.") and the field note is terse ("Doesn't match."), so the main
 * message is used for that field.
 */
export function serverFieldErrors(error: unknown, prefix?: string): Record<string, string> {
  if (!isApiError(error) || !error.fields) return {}
  const entries = Object.entries(error.fields)
  const useMain = entries.length === 1 && Boolean(error.message) && error.message !== GENERIC_VALIDATION_MESSAGE
  const out: Record<string, string> = {}
  for (const [key, message] of entries) {
    const name = prefix && key.startsWith(prefix) ? key.slice(prefix.length) : key
    out[name] = useMain ? error.message : message
  }
  return out
}

/**
 * Puts an API error's field messages on the matching form fields and moves
 * focus to the first one (in `order`). Returns true when at least one field
 * got a message, so the caller can skip a general message.
 */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  form: { setError: UseFormSetError<T>; setFocus: UseFormSetFocus<T> },
  order: Path<T>[],
  options: { prefix?: string; aliases?: Record<string, Path<T>> } = {}
): boolean {
  const targets = new Map<Path<T>, string>()
  for (const [key, message] of Object.entries(serverFieldErrors(error, options.prefix))) {
    const target = (options.aliases?.[key] ?? key) as Path<T>
    if (order.includes(target) && !targets.has(target)) targets.set(target, message)
  }
  for (const [target, message] of targets) form.setError(target, { type: "server", message })
  const first = order.find((name) => targets.has(name))
  if (!first) return false
  // Let React render the messages first so the field's description includes them.
  window.setTimeout(() => form.setFocus(first), 0)
  return true
}

/** A page section in a quiet panel, with its own heading. */
export function Section({
  id,
  title,
  description,
  actions,
  children,
  className,
  headingLevel = 2,
}: {
  id?: string
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  children?: React.ReactNode
  className?: string
  headingLevel?: 2 | 3
}) {
  const headingId = React.useId()
  const Heading = headingLevel === 2 ? "h2" : "h3"
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      data-slot="section"
      className={cn("scroll-mt-4 rounded-xl border bg-card p-5 sm:p-6", className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 space-y-1">
          <Heading id={headingId} tabIndex={-1} className="text-pane-title font-semibold text-foreground outline-none">
            {title}
          </Heading>
          {description && <p className="max-w-[68ch] text-ui text-ink-secondary">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-5">{children}</div>}
    </section>
  )
}

/** Saves a file the browser already has (CSV exports). No network. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.rel = "noopener"
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Copies text; resolves false when the browser refuses (no permission, insecure page). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Older browsers and some embedded views: fall back to a hidden textarea.
    try {
      const area = document.createElement("textarea")
      area.value = text
      area.setAttribute("readonly", "")
      area.style.position = "fixed"
      area.style.opacity = "0"
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand("copy")
      area.remove()
      return ok
    } catch {
      return false
    }
  }
}
