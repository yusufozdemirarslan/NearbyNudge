import * as React from "react"
import { useMutation } from "@tanstack/react-query"
import {
  Building2Icon,
  GlobeIcon,
  MailIcon,
  MessageSquareIcon,
  MapPinIcon,
  RotateCcwIcon,
  UserIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import type { DncEntry } from "@/lib/api/types"
import { formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { FieldMessage } from "@/features/settings/form-kit"
import { SOURCE_LABEL, entryLabel } from "./entries"

const SOURCE_ICON: Record<DncEntry["source"], typeof UserIcon> = {
  user: UserIcon,
  lead: MapPinIcon,
  reply: MessageSquareIcon,
}

/** An entry that was removed this visit, kept in place so Undo stays on the row. */
export interface RemovedEntry {
  entry: DncEntry
  restoring: boolean
  error: string | null
  toastId?: string
}

export type ListRow =
  | { kind: "entry"; entry: DncEntry }
  | { kind: "removed"; removed: RemovedEntry }

/** The identifiers an entry blocks (name, website, email), each with an icon and a spoken label. */
function Identifiers({ entry }: { entry: DncEntry }) {
  const primary = entryLabel(entry)
  const items: {
    key: string
    icon: typeof GlobeIcon
    label: string
    value: string
  }[] = []
  if (entry.business_name && entry.business_name !== primary)
    items.push({
      key: "name",
      icon: Building2Icon,
      label: "Business",
      value: entry.business_name,
    })
  if (entry.domain && entry.domain !== primary)
    items.push({
      key: "domain",
      icon: GlobeIcon,
      label: "Website",
      value: entry.domain,
    })
  if (entry.email && entry.email !== primary)
    items.push({
      key: "email",
      icon: MailIcon,
      label: "Email",
      value: entry.email,
    })
  if (items.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-list text-ink-secondary">
      {items.map((item) => (
        <li key={item.key} className="flex min-w-0 items-center gap-1.5">
          <item.icon
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
          />
          <span className="sr-only">{item.label}: </span>
          <span className="min-w-0 [overflow-wrap:anywhere]">{item.value}</span>
        </li>
      ))}
    </ul>
  )
}

/** What the primary line names, for screen readers ("Website", "Email"). */
function primaryKind(entry: DncEntry): string | null {
  if (entry.business_name) return null
  if (entry.domain) return "Website"
  if (entry.email) return "Email"
  return null
}

export function EntryRow({
  entry,
  fresh,
  focusOnMount,
  onFocused,
  onRemoved,
}: {
  entry: DncEntry
  /** Just added or restored: a soft teal tint fades out. */
  fresh: boolean
  /** Take focus once (after Undo restores this entry). */
  focusOnMount: boolean
  onFocused: () => void
  onRemoved: (entry: DncEntry) => void
}) {
  const rowRef = React.useRef<HTMLLIElement>(null)
  const label = entryLabel(entry)
  const kind = primaryKind(entry)
  const SourceIcon = SOURCE_ICON[entry.source]
  const mutation = useMutation({
    mutationFn: () => api.deleteDnc(entry.id),
    onSuccess: () => onRemoved(entry),
  })

  React.useEffect(() => {
    if (!focusOnMount) return
    rowRef.current?.focus()
    onFocused()
  }, [focusOnMount, onFocused])

  return (
    <li
      ref={rowRef}
      tabIndex={-1}
      data-testid="dnc-row"
      className={cn(
        "focus-inset flex flex-col gap-3 px-4 py-3.5 outline-none sm:flex-row sm:items-start sm:gap-6 sm:px-5",
        fresh && "animate-row-new motion-reduce:animate-none"
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-ui font-semibold [overflow-wrap:anywhere] text-foreground">
          {kind && <span className="sr-only">{kind}: </span>}
          {label}
        </p>
        <Identifiers entry={entry} />
        {entry.reason && (
          <p className="text-list text-ink-secondary">
            <span className="font-medium">Reason: </span>
            {entry.reason}
          </p>
        )}
        {mutation.isError && (
          <FieldMessage className="mt-1">
            We couldn&rsquo;t remove this. Check your connection and try again.
          </FieldMessage>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-4 sm:justify-end">
        <p className="flex items-center gap-1.5 text-meta text-ink-secondary">
          <SourceIcon
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
          />
          <span>
            <span className="sr-only">Added by </span>
            {SOURCE_LABEL[entry.source]}
            <span aria-hidden="true"> · </span>
            <span className="sr-only">, on </span>
            <time dateTime={entry.created_at}>
              {formatDate(entry.created_at)}
            </time>
          </span>
        </p>
        <Button
          variant="outline"
          size="sm"
          className="max-sm:h-11 max-sm:px-3.5"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? "Removing…" : "Remove"}
          <span className="sr-only"> {label}</span>
        </Button>
      </div>
    </li>
  )
}

export function RemovedRow({
  removed,
  focusOnMount,
  onFocused,
  onUndo,
}: {
  removed: RemovedEntry
  /** Take focus once (right after the person removed it), so they keep their place. */
  focusOnMount: boolean
  onFocused: () => void
  onUndo: () => void
}) {
  const buttonRef = React.useRef<HTMLButtonElement>(null)
  const label = entryLabel(removed.entry)

  React.useEffect(() => {
    if (!focusOnMount) return
    buttonRef.current?.focus()
    onFocused()
  }, [focusOnMount, onFocused])

  return (
    <li
      data-testid="dnc-removed-row"
      className="flex flex-col gap-2 bg-muted px-4 py-3 sm:flex-row sm:items-center sm:gap-6 sm:px-5"
    >
      <div className="min-w-0 flex-1">
        <p className="text-ui [overflow-wrap:anywhere] text-ink-secondary">
          Removed <span className="font-semibold text-foreground">{label}</span>
          . NearbyNudge can draft emails to it again.
        </p>
        {removed.error && (
          <FieldMessage className="mt-1">{removed.error}</FieldMessage>
        )}
      </div>
      <Button
        ref={buttonRef}
        variant="outline"
        size="sm"
        className="w-fit shrink-0 max-sm:h-11 max-sm:px-3.5"
        disabled={removed.restoring}
        onClick={onUndo}
      >
        <RotateCcwIcon aria-hidden="true" />
        {removed.restoring ? "Restoring…" : "Undo"}
        <span className="sr-only"> removing {label}</span>
      </Button>
    </li>
  )
}
