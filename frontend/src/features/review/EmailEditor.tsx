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
      className="border-t-(length:--rule-heavy) border-ink"
      data-slot="email-editor"
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <div className="space-y-1.5 border-b border-hairline py-4">
        <label htmlFor={subjectId} className="aside">
          Subject
        </label>
        <Input
          id={subjectId}
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          className="h-11 text-lead font-bold"
          aria-describedby={`${subjectId}-count`}
        />
        <SubjectCounter id={`${subjectId}-count`} words={countWords(subject)} />
      </div>
      <div className="space-y-1.5 py-4">
        <label htmlFor={bodyId} className="aside">
          Email
        </label>
        <Textarea
          id={bodyId}
          ref={bodyRef}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          className="min-h-88 max-w-measure text-body"
          aria-describedby={`${bodyId}-help ${bodyId}-count`}
          spellCheck
        />
        <p id={`${bodyId}-help`} className="aside">
          Greeting, a blank line, your paragraphs separated by blank lines, a blank line, then the signoff. Sentences
          you change are checked again.
        </p>
        <BodyCounter id={`${bodyId}-count`} words={countWords(body)} />
      </div>
      <LockedFooter footer={email.footer} />
      {error && (
        <p role="alert" className="mb-3 text-ui font-semibold text-edge">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-hairline py-3">
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
