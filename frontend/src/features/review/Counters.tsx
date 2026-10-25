import { Mark } from "@/components/Mark"
import { BODY_MAX_WORDS, BODY_MIN_WORDS, SUBJECT_MAX_WORDS } from "@/lib/email"
import { cn } from "@/lib/utils"

const base = "inline-flex items-center gap-1.5 text-meta tabular-nums"

/** "Subject: 6 words (max 10)"; amber with how many over when too long. */
export function SubjectCounter({ words, id, className }: { words: number; id?: string; className?: string }) {
  const over = words - SUBJECT_MAX_WORDS
  return (
    <span id={id} data-slot="subject-counter" className={cn(base, over > 0 ? "font-bold text-edge" : "italic", className)}>
      {over > 0 && <Mark name="asterisk" />}
      {over > 0
        ? `Subject: ${words} words, ${over} over (max ${SUBJECT_MAX_WORDS})`
        : `Subject: ${words} ${words === 1 ? "word" : "words"} (max ${SUBJECT_MAX_WORDS})`}
    </span>
  )
}

/** "112 words, aim for 80–130"; amber with "12 over" or "8 under" outside the range. */
export function BodyCounter({ words, id, className }: { words: number; id?: string; className?: string }) {
  const over = words - BODY_MAX_WORDS
  const under = BODY_MIN_WORDS - words
  const off = over > 0 || under > 0
  const range = `aim for ${BODY_MIN_WORDS}–${BODY_MAX_WORDS}`
  return (
    <span id={id} data-slot="body-counter" className={cn(base, off ? "font-bold text-edge" : "italic", className)}>
      {off && <Mark name="asterisk" />}
      {over > 0 ? `${words} words, ${over} over (${range})` : under > 0 ? `${words} words, ${under} under (${range})` : `${words} words, ${range}`}
    </span>
  )
}
