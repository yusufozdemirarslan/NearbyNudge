import * as React from "react"
import { Link } from "@tanstack/react-router"
import { Mark } from "@/components/Mark"
import { Button } from "@/components/ui/button"
import { useAnnounce } from "@/hooks/use-announce"
import { copyText } from "@/features/settings/form-kit"
import { cn } from "@/lib/utils"

/*
 * Reading layout for the public pages (/bot, /data-sources, /terms, /privacy),
 * set like a directory's front matter: 16/26 body text at most 68 characters a
 * line, condensed section heads with anchors, ink lists and ruled tables.
 * One typeface throughout.
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
        "flex max-w-measure flex-col gap-12 text-body",
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
      <h2 id={`${id}-title`} className="section-head">
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
    <h3 id={id} className="mt-2 text-lead font-bold">
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
        "flex list-disc flex-col gap-2 pl-6 marker:text-ink",
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
      className="font-semibold underline decoration-1 underline-offset-3 hover:text-edge"
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
      <div className="flex items-start gap-3 border-2 border-ink py-3 pr-3 pl-4">
        <pre className="min-w-0 flex-1 py-1 font-sans text-body font-bold [overflow-wrap:anywhere] whitespace-pre-wrap">
          <code className="font-sans">{code}</code>
        </pre>
        <Button
          variant="link"
          size="sm"
          className="shrink-0 px-1"
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
          {copied && <Mark name="check" />}
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
  return <p className="aside">Last updated {date}.</p>
}
