import { toast as manager } from "@/components/ui/toast"

/** Undo messages stay at least this long, and pause on hover or focus. */
export const UNDO_TIMEOUT_MS = 12_000

export interface NotifyOptions {
  title: string
  description?: string
  /** One button, e.g. Undo. */
  action?: { label: string; onClick: () => void }
  /** Milliseconds; defaults to 12 s for messages with an action, 6 s otherwise. */
  timeout?: number
  type?: "success" | "info" | "warning" | "error"
  /** Reuse an id to update a message in place. */
  id?: string
}

/**
 * Shows a toast (Base UI Toast). Toasts are announced politely, pause while
 * the pointer or keyboard focus is on them, and F6 moves focus into them.
 * Never use a toast as the only place an error or an Undo lives.
 */
export function notify(options: NotifyOptions): string {
  return manager.add({
    id: options.id,
    title: options.title,
    description: options.description,
    type: options.type,
    timeout: options.timeout ?? (options.action ? UNDO_TIMEOUT_MS : 6000),
    actionProps: options.action
      ? {
          children: options.action.label,
          onClick: options.action.onClick,
        }
      : undefined,
  })
}

/** Closes one toast, or all of them without an id. */
export function dismissToast(id?: string) {
  manager.close(id)
}
