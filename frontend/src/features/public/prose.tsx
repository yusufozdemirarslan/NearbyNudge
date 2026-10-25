import * as React from "react"
import { Link } from "@tanstack/react-router"
import { CheckIcon, CopyIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAnnounce } from "@/hooks/use-announce"
import { copyText } from "@/features/settings/form-kit"
import { cn } from "@/lib/utils"

/*
 * Reading layout for the public pages (/bot, /data-sources, /terms, /privacy):
 * 16/25 body text at most 68 characters a line, section headings with
 * anchors, quiet lists and tables. One typeface throughout (brief §6).
 */

/** The page body: a single reading column. */
export function Prose({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex max-w-[68ch] flex-col gap-10 text-email text-foreground",
        className
      )}
    >
      {children}
    </div>
  )
}

/** A section with its own h2 (and an id, so it can be linked to). */
export function ProseSection({
  id,
  title,
  children,
  className,
}: {
  id: string
  title: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn("flex scroll-mt-6 flex-col gap-4", className)}
    >
      <h2
        id={`${id}-title`}
        className="text-pane-title font-semibold text-foreground"
      >
        {title}
      </h2>
      {children}
    </section>
  )
}

/** A smaller heading inside a section. */
export function SubHeading({
  children,
  id,
}: {
  children: React.ReactNode
  id?: string
}) {
  return (
    <h3 id={id} className="mt-2 text-email font-semibold text-foreground">
      {children}
    </h3>
  )
}

/** A bulleted list with readable spacing. */
export function List({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <ul
      className={cn(
        "flex list-disc flex-col gap-2 pl-6 marker:text-muted-foreground",
        className
      )}
    >
      {children}
    </ul>
  )
}

/** A link to another page of the app, styled for running text. */
export function TextLink({
  children,
  ...props
}: React.ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      className="rounded-xs font-medium text-primary underline decoration-[color-mix(in_srgb,var(--primary)_45%,transparent)] underline-offset-3 hover:decoration-primary"
    >
      {children}
    </Link>
  )
}

/** A short, exact string (a user agent, robots.txt lines) with a Copy button. */
export function CodeBlock({ code, label }: { code: string; label: string }) {
  const announce = useAnnounce()
  const [copied, setCopied] = React.useState(false)
  React.useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2500)
    return () => window.clearTimeout(timer)
  }, [copied])
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="sr-only">{label}</figcaption>
      <div className="flex items-start gap-3 rounded-xl border bg-card py-3 pr-2 pl-4">
        <pre className="min-w-0 flex-1 py-1 font-sans text-ui font-medium [overflow-wrap:anywhere] whitespace-pre-wrap text-foreground">
          <code className="font-sans">{code}</code>
        </pre>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0"
          aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
          onClick={async () => {
            const ok = await copyText(code)
            setCopied(ok)
            announce(
              ok
                ? "Copied"
                : "Couldn't copy. Select the text and copy it instead."
            )
          }}
        >
          {copied ? (
            <CheckIcon aria-hidden="true" />
          ) : (
            <CopyIcon aria-hidden="true" />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </figure>
  )
}

/** Keeps a short term ("CAN-SPAM Act") on one line. */
export function NoWrap({ children }: { children: React.ReactNode }) {
  return <span className="whitespace-nowrap">{children}</span>
}

/** "Last updated" line under a page header. */
export function Updated({ date }: { date: string }) {
  return <p className="text-ui text-ink-secondary">Last updated {date}.</p>
}
