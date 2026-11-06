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
import { isApiError } from "@/lib/api/client"
import { meQuery, sessionQuery } from "@/lib/api/queries"
import { safeRedirect } from "@/lib/redirect"
import { queryClient, setSignedOutHandler } from "./query-client"

export interface RouterContext {
  queryClient: QueryClient
}

/** The workspace; a browser that isn't signed in goes to the sign-in page first, and comes back here after. */
async function currentUser(context: RouterContext, from: string) {
  // Known to be signed out: straight to sign-in, without a request the server would refuse.
  const session = await context.queryClient.ensureQueryData(sessionQuery())
  if (session.enabled && !session.signed_in) throw redirect({ to: "/login", search: { redirect: from } })
  try {
    const me = await context.queryClient.ensureQueryData(meQuery())
    return me.user
  } catch (error) {
    if (isApiError(error, "auth_required")) throw redirect({ to: "/login", search: { redirect: from } })
    throw error
  }
}

/** Pages anyone may read: a request refused there for want of a session sends no one to sign in. */
const OPEN_PATHS = new Set(["/login", "/bot", "/data-sources", "/terms", "/privacy"])

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
        pageHeading
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
  beforeLoad: async ({ context, location }) => {
    const user = await currentUser(context, location.href)
    if (user.onboarded) throw redirect({ to: "/" })
  },
  component: lazyRouteComponent(() => import("@/features/onboarding/OnboardingPage"), "OnboardingPage"),
})

/**
 * Sign-in for the one account, when this copy asks for it. A signed-in browser, or a copy without sign-in,
 * goes straight on to `redirect` (or campaigns).
 */
const loginRoute = createRoute({
  getParentRoute: () => setupLayout,
  path: "/login",
  // The key is always returned: the router keeps a raw search value the validator leaves out.
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({ redirect: safeRedirect(search.redirect) }),
  beforeLoad: async ({ context, search }) => {
    const session = await context.queryClient.fetchQuery({ ...sessionQuery(), staleTime: 0 })
    if (!session.enabled || session.signed_in) throw redirect({ href: safeRedirect(search.redirect) ?? "/" })
  },
  component: lazyRouteComponent(() => import("@/features/auth/LoginPage"), "LoginPage"),
})

/** Old links: /signin goes to the sign-in page; /signup?invite=… and /recover (removed with passkeys) open the app. */
function openTheApp(): never {
  throw redirect({ to: "/" })
}
const oldSignInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/signin",
  beforeLoad: () => {
    throw redirect({ to: "/login" })
  },
})
const oldSignUpRoute = createRoute({ getParentRoute: () => rootRoute, path: "/signup", beforeLoad: openTheApp })
const oldRecoverRoute = createRoute({ getParentRoute: () => rootRoute, path: "/recover", beforeLoad: openTheApp })

// ---------------------------------------------------------------------------
// The app
// ---------------------------------------------------------------------------

const appLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  beforeLoad: async ({ context, location }) => {
    const user = await currentUser(context, location.href)
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
  setupLayout.addChildren([onboardingRoute, loginRoute]),
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

// A session that ends mid-visit (it ran out, or another tab signed out) leads to the sign-in page, then back here.
setSignedOutHandler(() => {
  const { pathname, href } = router.state.location
  if (OPEN_PATHS.has(pathname)) return
  queryClient.removeQueries({ queryKey: meQuery().queryKey })
  void router.navigate({ to: "/login", search: { redirect: safeRedirect(href) }, replace: true })
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
