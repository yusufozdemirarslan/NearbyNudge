import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Link,
  Outlet,
  redirect,
  useRouter,
  useRouterState,
} from "@tanstack/react-router"
import type { QueryClient } from "@tanstack/react-query"
import { CalmError } from "@/components/CalmError"
import { buttonVariants } from "@/components/ui/button"
import { AppShell } from "@/components/shell/AppShell"
import { PublicLayout, SetupLayout, StandalonePage } from "@/components/shell/PublicLayout"
import { ThemeSync } from "@/components/shell/ThemeSync"
import { CampaignsPage } from "@/features/campaigns/CampaignsPage"
import { ReviewDeskPage } from "@/features/review/ReviewDeskPage"
import { validateDeskSearch } from "@/features/review/search"
import { SentPage, validateSentSearch } from "@/features/sent/SentPage"
import { usePreferences } from "@/hooks/use-account"
import { CommandsProvider } from "@/hooks/use-commands"
import { ShortcutsProvider } from "@/hooks/use-shortcuts"
import { meQuery } from "@/lib/api/queries"
import { queryClient } from "./query-client"

export interface RouterContext {
  queryClient: QueryClient
}

async function currentUser(context: RouterContext) {
  const me = await context.queryClient.ensureQueryData(meQuery())
  return me.user
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

function RootLayout() {
  const preferences = usePreferences()
  return (
    <ShortcutsProvider singleKeyEnabled={preferences.shortcuts_enabled}>
      <CommandsProvider>
        <ThemeSync />
        <Outlet />
      </CommandsProvider>
    </ShortcutsProvider>
  )
}

function RootError({ error }: { error: unknown }) {
  const router = useRouter()
  return (
    <StandalonePage>
      <CalmError
        title="We couldn't open this page"
        error={error}
        onRetry={() => void router.invalidate()}
        action={
          <Link to="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Go to campaigns
          </Link>
        }
      />
    </StandalonePage>
  )
}

/** A dead end, said plainly: the address that wasn't found, struck through like a filed entry. */
function NotFound() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  return (
    <StandalonePage>
      <div className="flex flex-col items-start gap-4">
        <h1 className="running-head">{"We couldn't find that page"}</h1>
        <p className="text-lead font-bold break-all line-through decoration-edge decoration-2">{pathname}</p>
        <p className="max-w-measure text-ui">The link may be old, or the item was deleted.</p>
        <Link to="/" className={buttonVariants({ className: "mt-2" })}>
          Go to campaigns
        </Link>
      </div>
    </StandalonePage>
  )
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  errorComponent: RootError,
  notFoundComponent: NotFound,
})

// ---------------------------------------------------------------------------
// Public pages (also for site owners who never use the app)
// ---------------------------------------------------------------------------

const publicLayout = createRoute({ getParentRoute: () => rootRoute, id: "public", component: PublicLayout })

const botRoute = createRoute({
  getParentRoute: () => publicLayout,
  path: "/bot",
  component: lazyRouteComponent(() => import("@/features/public/BotPage"), "BotPage"),
})
const dataSourcesRoute = createRoute({
  getParentRoute: () => publicLayout,
  path: "/data-sources",
  component: lazyRouteComponent(() => import("@/features/public/DataSourcesPage"), "DataSourcesPage"),
})
const termsRoute = createRoute({
  getParentRoute: () => publicLayout,
  path: "/terms",
  component: lazyRouteComponent(() => import("@/features/public/TermsPage"), "TermsPage"),
})
const privacyRoute = createRoute({
  getParentRoute: () => publicLayout,
  path: "/privacy",
  component: lazyRouteComponent(() => import("@/features/public/PrivacyPage"), "PrivacyPage"),
})

// ---------------------------------------------------------------------------
// First run: the one-time sender profile (there is no sign-in)
// ---------------------------------------------------------------------------

const setupLayout = createRoute({ getParentRoute: () => rootRoute, id: "setup", component: SetupLayout })

/** Shown until the sender profile exists: every email needs a sender and a postal address. */
const onboardingRoute = createRoute({
  getParentRoute: () => setupLayout,
  path: "/onboarding",
  beforeLoad: async ({ context }) => {
    const user = await currentUser(context)
    if (user.onboarded) throw redirect({ to: "/" })
  },
  component: lazyRouteComponent(() => import("@/features/onboarding/OnboardingPage"), "OnboardingPage"),
})

/** Links from before sign-in was removed (/signin, /signup?invite=…, /recover) open the app. */
function openTheApp(): never {
  throw redirect({ to: "/" })
}
const oldSignInRoute = createRoute({ getParentRoute: () => rootRoute, path: "/signin", beforeLoad: openTheApp })
const oldSignUpRoute = createRoute({ getParentRoute: () => rootRoute, path: "/signup", beforeLoad: openTheApp })
const oldRecoverRoute = createRoute({ getParentRoute: () => rootRoute, path: "/recover", beforeLoad: openTheApp })

// ---------------------------------------------------------------------------
// The app
// ---------------------------------------------------------------------------

const appLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  beforeLoad: async ({ context }) => {
    const user = await currentUser(context)
    if (!user.onboarded) throw redirect({ to: "/onboarding" })
  },
  component: AppShell,
})

const homeRoute = createRoute({ getParentRoute: () => appLayout, path: "/", component: CampaignsPage })

const newCampaignRoute = createRoute({
  getParentRoute: () => appLayout,
  path: "/campaigns/new",
  component: lazyRouteComponent(() => import("@/features/new-campaign/NewCampaignPage"), "NewCampaignPage"),
})

/** The review desk. `view`, `lead` and `sort` live in the URL. */
export const deskRoute = createRoute({
  getParentRoute: () => appLayout,
  path: "/campaigns/$campaignId",
  validateSearch: validateDeskSearch,
  component: ReviewDeskPage,
})

const sentRoute = createRoute({
  getParentRoute: () => appLayout,
  path: "/sent",
  validateSearch: validateSentSearch,
  component: SentPage,
})

const numbersRoute = createRoute({
  getParentRoute: () => appLayout,
  path: "/numbers",
  component: lazyRouteComponent(() => import("@/features/numbers/NumbersPage"), "NumbersPage"),
})

const dncRoute = createRoute({
  getParentRoute: () => appLayout,
  path: "/dnc",
  component: lazyRouteComponent(() => import("@/features/dnc/DncPage"), "DncPage"),
})

const settingsRoute = createRoute({
  getParentRoute: () => appLayout,
  path: "/settings",
  component: lazyRouteComponent(() => import("@/features/settings/SettingsPage"), "SettingsPage"),
})

const adminRoute = createRoute({
  getParentRoute: () => appLayout,
  path: "/admin",
  component: lazyRouteComponent(() => import("@/features/admin/AdminPage"), "AdminPage"),
})

const routeTree = rootRoute.addChildren([
  publicLayout.addChildren([botRoute, dataSourcesRoute, termsRoute, privacyRoute]),
  setupLayout.addChildren([onboardingRoute]),
  oldSignInRoute,
  oldSignUpRoute,
  oldRecoverRoute,
  appLayout.addChildren([
    homeRoute,
    newCampaignRoute,
    deskRoute,
    sentRoute,
    numbersRoute,
    dncRoute,
    settingsRoute,
    adminRoute,
  ]),
])

export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
  defaultPendingMs: 600,
  defaultNotFoundComponent: NotFound,
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
