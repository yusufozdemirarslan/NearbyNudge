import { cn } from "@/lib/utils"

/**
 * The directory's printer's marks: small drawn glyphs that stand beside a word
 * (never instead of one). One stroke weight, square ends, current colour.
 */
export type MarkName =
  | "ring"
  | "dot"
  | "square"
  | "asterisk"
  | "check"
  | "envelope"
  | "reply"
  | "slash"
  | "barred"
  | "cross"
  | "pointer"
  | "pause"

const SHAPES: Record<MarkName, React.ReactNode> = {
  ring: <circle cx="6" cy="6" r="3.6" />,
  dot: <circle cx="6" cy="6" r="3.4" fill="currentColor" stroke="none" />,
  square: <rect x="2.6" y="2.6" width="6.8" height="6.8" fill="currentColor" stroke="none" />,
  asterisk: <path d="M6 1.4v9.2M2 3.7l8 4.6M2 8.3l8-4.6" />,
  check: <path d="M2.2 6.4l2.6 2.6 5-5.6" />,
  envelope: <path d="M1.6 3h8.8v6.4H1.6zM1.8 3.3 6 6.6l4.2-3.3" />,
  reply: <path d="M1.8 2.4h8.4v5.4H5.6L3 10.2V7.8H1.8z" />,
  slash: <path d="M3.2 10.4 8.8 1.6" />,
  barred: (
    <>
      <circle cx="6" cy="6" r="4.2" />
      <path d="M3.1 8.9 8.9 3.1" />
    </>
  ),
  cross: <path d="M2.6 2.6l6.8 6.8M9.4 2.6 2.6 9.4" />,
  pointer: <path d="M3 1.8 10 6l-7 4.2z" fill="currentColor" stroke="none" />,
  pause: <path d="M4 2.4v7.2M8 2.4v7.2" />,
}

export function Mark({ name, className }: { name: MarkName; className?: string }) {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      data-slot="mark"
      data-mark={name}
      className={cn("size-3 shrink-0", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="square"
      strokeLinejoin="miter"
    >
      {SHAPES[name]}
    </svg>
  )
}
