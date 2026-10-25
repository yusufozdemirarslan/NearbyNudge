import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/toast"
import { AnnouncerProvider } from "@/hooks/use-announce"
import { queryClient } from "@/app/query-client"
import { router } from "@/app/router"
import { QueryDevtools } from "@/app/devtools"
import "./index.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AnnouncerProvider>
        <TooltipProvider delay={400}>
          <Toaster limit={3}>
            <RouterProvider router={router} />
          </Toaster>
        </TooltipProvider>
      </AnnouncerProvider>
      <QueryDevtools />
    </QueryClientProvider>
  </StrictMode>
)
