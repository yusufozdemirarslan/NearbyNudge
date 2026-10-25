/**
 * "Skip to main content": the first focusable element on every page. Hidden
 * until focused. Targets <main id="main-content" tabIndex={-1}>.
 */
export function SkipLink({ target = "main-content" }: { target?: string }) {
  return (
    <a
      href={`#${target}`}
      onClick={(event) => {
        const main = document.getElementById(target)
        if (!main) return
        event.preventDefault()
        main.focus()
        main.scrollIntoView({ block: "start" })
      }}
      className="fixed top-2 left-2 z-100 -translate-y-20 bg-ink px-4 py-2 text-ui font-semibold text-paper transition-transform duration-(--dur-fast) focus:translate-y-0"
    >
      Skip to main content
    </a>
  )
}
