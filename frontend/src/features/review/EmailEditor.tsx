import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { KeyHint } from "@/components/KeyHint"
import { useShortcuts } from "@/hooks/use-shortcuts"
import type { Email } from "@/lib/api/types"
import { composeBody, countWords } from "@/lib/email"
import { BodyCounter, SubjectCounter } from "./Counters"
import { LockedFooter } from "./EmailBody"

export interface EmailEditorProps {
  email: Email
  /** Draft kept by the desk when the user moves to another lead and back. */
  draft?: { subject: string; body: string }
  onDraftChange: (draft: { subject: string; body: string }) => void
  onSave: (subject: string, body: string) => void
  onCancel: () => void
  busy: boolean
  error?: string | null
}

/**
 * Edit mode (E): the subject and the body as plain text in the API's body
 * format (greeting, blank line, paragraphs, blank line, signoff). The footer
 * stays locked below. Ctrl/⌘ Enter saves, Esc cancels.
 */
export function EmailEditor({ email, draft, onDraftChange, onSave, onCancel, busy, error }: EmailEditorProps) {
  const [subject, setSubject] = React.useState(draft?.subject ?? email.subject)
  const [body, setBody] = React.useState(draft?.body ?? composeBody(email))
  const bodyRef = React.useRef<HTMLTextAreaElement>(null)
  const subjectId = React.useId()
  const bodyId = React.useId()

  React.useEffect(() => {
    bodyRef.current?.focus()
  }, [])

  React.useEffect(() => {
    onDraftChange({ subject, body })
  }, [subject, body, onDraftChange])

  const save = () => {
    if (!busy && subject.trim() && body.trim()) onSave(subject, body)
  }

  useShortcuts(
    {
      "mod+enter": { description: "Save the email", handler: save, allowInInputs: true, group: "Editing" },
      escape: { description: "Cancel editing", handler: onCancel, allowInInputs: true, group: "Editing" },
    },
    { group: "Editing" }
  )

  return (
    <form
      className="rounded-xl border bg-card"
      data-slot="email-editor"
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <div className="space-y-1.5 border-b px-5 py-4 sm:px-6">
        <label htmlFor={subjectId} className="text-meta font-medium text-muted-foreground">
          Subject
        </label>
        <Input
          id={subjectId}
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          className="h-10 text-email font-semibold"
          aria-describedby={`${subjectId}-count`}
        />
        <SubjectCounter id={`${subjectId}-count`} words={countWords(subject)} />
      </div>
      <div className="space-y-1.5 px-5 py-4 sm:px-6">
        <label htmlFor={bodyId} className="text-meta font-medium text-muted-foreground">
          Email
        </label>
        <Textarea
          id={bodyId}
          ref={bodyRef}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          className="min-h-[22rem] max-w-[68ch] text-email leading-[25px]"
          aria-describedby={`${bodyId}-help ${bodyId}-count`}
          spellCheck
        />
        <p id={`${bodyId}-help`} className="text-meta text-muted-foreground">
          Greeting, a blank line, your paragraphs separated by blank lines, a blank line, then the signoff. Sentences
          you change are checked again.
        </p>
        <BodyCounter id={`${bodyId}-count`} words={countWords(body)} />
      </div>
      <LockedFooter footer={email.footer} />
      {error && (
        <p role="alert" className="mx-5 mb-3 rounded-lg bg-warning-tint px-3 py-2 text-ui text-foreground sm:mx-6">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3 sm:px-6">
        <Button type="submit" disabled={busy || !subject.trim() || !body.trim()} aria-keyshortcuts="Control+Enter Meta+Enter">
          {busy ? "Saving…" : "Save"}
          <KeyHint keys="mod+Enter" />
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy} aria-keyshortcuts="Escape">
          Cancel
          <KeyHint keys="Esc" always />
        </Button>
      </div>
    </form>
  )
}
