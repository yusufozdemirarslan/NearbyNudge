import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/*
 * Tabs as a directory's thumb index: die-cut tabs outlined in ink, the open one filled edge red.
 * `variant="thumb"` (default) runs along the top edge; `orientation="vertical"`
 * cuts them into the side edge with the labels running up the tab.
 * `variant="line"` is a quiet underlined row for secondary switches.
 */
function Tabs({ className, orientation = "horizontal", ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn("group/tabs flex gap-2 data-horizontal:flex-col", className)}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list flex w-fit text-ui group-data-vertical/tabs:flex-col",
  {
    variants: {
      variant: {
        default: "flex-wrap items-end gap-1",
        line: "items-center gap-5",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({ className, variant = "default", ...props }: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex items-center gap-2 font-semibold whitespace-nowrap outline-none select-none transition-colors duration-(--dur-fast) disabled:pointer-events-none disabled:text-ink-soft [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        // thumb index: die-cut tabs drawn in ink on paper, open on the rule they stand on; the open one is red
        "group-data-[variant=default]/tabs-list:h-9 group-data-[variant=default]/tabs-list:rounded-t-tab group-data-[variant=default]/tabs-list:border-2 group-data-[variant=default]/tabs-list:border-b-0 group-data-[variant=default]/tabs-list:border-ink group-data-[variant=default]/tabs-list:bg-paper group-data-[variant=default]/tabs-list:px-4 group-data-[variant=default]/tabs-list:text-ink group-data-[variant=default]/tabs-list:hover:underline group-data-[variant=default]/tabs-list:hover:underline-offset-4 group-data-[variant=default]/tabs-list:data-active:border-edge group-data-[variant=default]/tabs-list:data-active:bg-edge group-data-[variant=default]/tabs-list:data-active:text-edge-ink",
        // cut into the side edge: labels run up the tab, the open side against the rail
        "group-data-vertical/tabs:group-data-[variant=default]/tabs-list:h-auto group-data-vertical/tabs:group-data-[variant=default]/tabs-list:w-10 group-data-vertical/tabs:group-data-[variant=default]/tabs-list:rotate-180 group-data-vertical/tabs:group-data-[variant=default]/tabs-list:rounded-t-none group-data-vertical/tabs:group-data-[variant=default]/tabs-list:rounded-r-tab group-data-vertical/tabs:group-data-[variant=default]/tabs-list:border-b-2 group-data-vertical/tabs:group-data-[variant=default]/tabs-list:border-l-0 group-data-vertical/tabs:group-data-[variant=default]/tabs-list:px-0 group-data-vertical/tabs:group-data-[variant=default]/tabs-list:py-5 group-data-vertical/tabs:group-data-[variant=default]/tabs-list:gap-2.5 group-data-vertical/tabs:group-data-[variant=default]/tabs-list:[writing-mode:vertical-rl]",
        // line: underlined words
        "group-data-[variant=line]/tabs-list:h-9 group-data-[variant=line]/tabs-list:border-b-(length:--rule-heavy) group-data-[variant=line]/tabs-list:border-transparent group-data-[variant=line]/tabs-list:hover:border-ink group-data-[variant=line]/tabs-list:data-active:border-edge",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return <TabsPrimitive.Panel data-slot="tabs-content" className={cn("flex-1 text-ui outline-none", className)} {...props} />
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
