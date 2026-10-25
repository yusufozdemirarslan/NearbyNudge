import * as React from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Input } from "@/components/ui/input"
import { useAnnounce } from "@/hooks/use-announce"
import { api } from "@/lib/api"
import { qk } from "@/lib/api/queries"
import { plural } from "@/lib/format"
import { cn } from "@/lib/utils"
import { inputClass, type ControlProps } from "@/features/settings/form-kit"

/** Returns `value` after it has stopped changing for `delay` ms. */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export interface LocationComboboxProps extends ControlProps {
  name: string
  value: string
  onChange: (value: string) => void
  onBlur: () => void
  inputRef?: React.Ref<HTMLInputElement>
  placeholder?: string
}

/**
 * "Where": a text box with city and ZIP suggestions from the Census files
 * (GET /api/geo/suggest), following the ARIA 1.2 combobox pattern: the list
 * opens as you type (2+ characters), ArrowDown/ArrowUp move through it, Enter
 * picks the highlighted place, Escape closes it. Any typed text is still a
 * valid answer; the server checks it when the plan is reviewed.
 */
export function LocationCombobox({
  id,
  name,
  value,
  onChange,
  onBlur,
  inputRef,
  placeholder,
  ...aria
}: LocationComboboxProps) {
  const announce = useAnnounce()
  const listboxId = `${id}-listbox`
  const [open, setOpen] = React.useState(false)
  const [active, setActive] = React.useState(-1)
  const [query, setQuery] = React.useState("")
  const [focused, setFocused] = React.useState(false)
  const debounced = useDebouncedValue(query.trim(), 200)
  const lastAnnounced = React.useRef<string | null>(null)

  const suggestions = useQuery({
    queryKey: qk.geo(debounced.toLowerCase()),
    queryFn: () => api.geoSuggest(debounced),
    enabled: debounced.length >= 2,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  })
  const results = React.useMemo(
    () => (debounced.length >= 2 ? (suggestions.data?.results ?? []) : []),
    [debounced, suggestions.data]
  )
  const expanded = open && results.length > 0
  // The highlight never points past the list when results shrink.
  const highlighted = active < results.length ? active : -1

  // Tell screen reader users how many places matched, once per query.
  React.useEffect(() => {
    if (!focused || !open || suggestions.isFetching || debounced.length < 2)
      return
    if (lastAnnounced.current === debounced) return
    lastAnnounced.current = debounced
    announce(
      results.length > 0
        ? `${plural(results.length, "place")} found. Use the up and down arrow keys to choose one.`
        : "No matching places. Try a ZIP code, or a city with its state."
    )
  }, [
    announce,
    debounced,
    focused,
    open,
    results.length,
    suggestions.isFetching,
  ])

  const choose = (index: number) => {
    const place = results[index]
    if (!place) return
    onChange(place.label)
    setQuery("")
    setOpen(false)
    setActive(-1)
    announce(`${place.label} chosen`)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      if (results.length === 0) return
      event.preventDefault()
      if (!open) {
        setOpen(true)
        setActive(0)
        return
      }
      setActive((highlighted + 1) % results.length)
    } else if (event.key === "ArrowUp") {
      if (!expanded) return
      event.preventDefault()
      setActive(highlighted <= 0 ? results.length - 1 : highlighted - 1)
    } else if (event.key === "Enter") {
      if (expanded && highlighted >= 0) {
        event.preventDefault()
        choose(highlighted)
      } else {
        setOpen(false)
      }
    } else if (event.key === "Escape") {
      if (expanded) {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
        setActive(-1)
      }
    } else if (event.key === "Tab") {
      setOpen(false)
    }
  }

  const activeId =
    expanded && highlighted >= 0 ? `${id}-option-${highlighted}` : undefined

  return (
    <div className="relative min-w-0 flex-1">
      <Input
        {...aria}
        id={id}
        ref={inputRef}
        name={name}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listboxId}
        aria-activedescendant={activeId}
        autoComplete="off"
        autoCapitalize="words"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        className={inputClass}
        onChange={(event) => {
          onChange(event.target.value)
          setQuery(event.target.value)
          setOpen(true)
          setActive(-1)
          lastAnnounced.current = null
        }}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          setOpen(false)
          setActive(-1)
          onBlur()
        }}
      />
      <ul
        id={listboxId}
        role="listbox"
        aria-label="Suggested places"
        hidden={!expanded}
        className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto border border-ink bg-paper p-1 text-ink shadow-overlay"
      >
        {results.map((place, index) => (
          <li
            key={`${place.kind}-${place.label}`}
            id={`${id}-option-${index}`}
            role="option"
            aria-selected={index === highlighted}
            onMouseDown={(event) => event.preventDefault()}
            onMouseMove={() => setActive(index)}
            onClick={() => choose(index)}
            className={cn(
              "flex min-h-10 cursor-pointer items-center justify-between gap-3 px-2.5 py-1.5 text-ui",
              index === highlighted && "bg-ink text-paper"
            )}
          >
            <span className="truncate">{place.label}</span>
            <span className="shrink-0 aside">
              {place.kind === "zip" ? "ZIP code" : "City"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
