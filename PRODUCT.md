# Product

<!-- impeccable:product-schema 1 -->

Sources: the PRD (`../NearbyNudge-2.0-PRD.md`), the code in this repo, and the owner's own instructions in the build sessions. Facts marked *(inferred)* were not confirmed by the owner directly; correct them here.

## Platform

web

## Users

- **Primary: the founder or sales lead of a small B2B service firm** (1–50 staff), such as an ads agency, web designer, commercial cleaner or insurance broker, who spends 5+ hours a week finding local businesses to contact. The PRD's persona is Maya, who runs a 6-person Google Ads agency in Arlington, VA: "We spend half our day just finding who to email."
- **Their scene:** a desk in daylight, next to their own email app, working through a batch of 10–20 drafts in one sitting, mostly with the keyboard *(inferred from the PRD's journeys and the desk's single-key shortcuts)*.
- **Right now: an audience watching a live demo.** The owner removed sign-in because the app "is going to be a demo in front of people". It runs on one computer at http://localhost:8000.
- **Site owners** who follow the reader's link to /bot to see who visited their site, or who opt out there. They never use the app itself.

## Product Purpose

NearbyNudge turns three inputs into a desk of real nearby businesses:
- **where** you sell (a ZIP or city, plus a radius in miles);
- **who** you sell to (a category, such as dentists);
- **what** you offer.

Each business arrives with:
- what we learned from its own website, linked to the source page;
- the reason to reach out (the hook);
- its published contact;
- a short draft email that an editor pass has checked.

The person reviews each draft, then approves it, edits it, rewrites it, skips it or marks it do not contact. They send it themselves from their own email app, mark it as sent, and log any replies.

**Success looks like:**
- a first approved email within 5 minutes of starting;
- emails approved with light edits or none;
- facts that their linked source supports.

## Positioning

**Every sentence a draft states about a business comes from a fact read on that business's own website.**
- Each fact links to its source, and an editor check runs before a person ever sees the draft.
- Sending stays in the person's hands: copy the email or open it in their email app, then mark it as sent, up to 20 a day.

The app shows its work at three levels:
- the quote behind each claim;
- the site check behind each hook;
- the AI cost behind each lead.

## Operating Context

**Workspace**
- One built-in workspace and no sign-in.
- The first run asks once for the sender profile: name, company, postal address (required by CAN-SPAM), tone and time zone.

**Campaign flow**
1. Enter a location, radius, category and offer.
2. The AI restates the plan and asks at most one question.
3. Businesses are found from free open listings (Overture Maps), then researched live.
4. Each lead moves through *queued → reading → choosing → writing → checking* and ends as *ready*, *needs review* or *couldn't finish*.

**Review desk**
- A lead list, the email, and the evidence (facts, contact, site check).
- Single-key triage:
  - J/K to move between leads;
  - A approve, E edit, S skip, Shift+D do not contact;
  - 1–4 rewrites (shorter, friendlier, more direct, another hook);
  - C copy, O open in my email app, M mark as sent, R log a reply;
  - Z undo, X select.
- A command menu (Ctrl/⌘ K) and a shortcut sheet (?).
- Live updates can be paused.

**Sending preview**
- Copy, or open in my email app, then mark as sent.
- "Sent today 7 of 20" is always visible.
- A monthly allowance of 100 leads.

**Other screens**
- **Sent:** the log, with replies.
- **Numbers:** found, approved, sent and replies, by campaign and week.
- **Do not contact:** the list.
- **Settings:** sender profile, preferences, usage, delete all data.
- **Admin:** AI spend, AI calls, quality audit, opt-outs, pause and resume.
- **Public pages:** bot, data sources, privacy, terms.

**Under the hood**
- One AI does every intelligent job: Claude Sonnet 5.5 (effort medium).
- Free open-source tools do the rest.

## Capabilities and Constraints

**Not in the product, on purpose**
- Real email sending (sending is a proof of concept).
- Maps on screen (they need another service).
- Google ratings.
- Contacting consumers.
- Businesses outside the US.

**Data the screens can show truthfully**
- Leads carry a distance in miles but no coordinates. Only the campaign's center point has coordinates, so no screen may imply where a business sits beyond its distance.

**Fixed for the redesign**
- Features, data, business logic, API calls, routes, form fields and validation, permissions.
- Everything tests and integrations rely on: `data-slot` and other `data-*` attributes, IDs, API contracts, CSV columns, and the text of the copied email.

**Assets**
- Fonts and assets must be self-hosted. The Content-Security-Policy allows `'self'` only; no font or icon service is contacted.

**Vocabulary already in use**
- campaign, lead, fit (Strong fit / Good fit / …), fact, evidence, source, hook, draft, approve, skip, do not contact, sending preview, mark as sent, replied, sent today, daily cap, live updates, AI spend.

## Brand Commitments

- The name is NearbyNudge, with an existing small brand mark (`frontend/src/components/shell/BrandMark.tsx`).
- The voice is plain, calm and specific, written from the user's side:
  - errors say what happened and what to do, without apologizing;
  - AI-written content is labelled as such.
- On 2026-10-25 the owner judged the current look generic and AI-made. The incumbent world ("Street index": teal `#007378`, Atkinson Hyperlegible Next, white panels on pale blue-grey) is evidence only, not authority.

## Evidence on Hand

- **Sample data:** the mock adapter's sample campaign, "Dentists within 5 mi of Arlington, VA" (`frontend/src/lib/api/mock/`). The businesses are synthetic, and any design shot that shows them must not be passed off as real.
- **Live-run screenshots:** `docs/live-ui/` shows real businesses. It is gitignored because it contains real contact details, and must never ship in the app or in design material.
- **Measured AI cost:** about $0.04–0.07 per lead in live runs.
- **What does not exist:** testimonials, customer logos, pricing or adoption numbers. None may be invented.

## Product Principles

1. **Facts before flattery.** Anything an email claims about a business must be traceable to that business's own words.
2. **The person sends.** Nothing leaves without a human approving it and sending it themselves.
3. **Fast, calm triage.** Reviewing twenty drafts should feel like clearing a desk: the keyboard first, undo instead of "Are you sure?".
4. **Show the work.** Sources, checks, costs and limits are visible, not hidden behind the AI.
5. **Respect the businesses.** A polite reader, opt-outs honoured at once, and do not contact means never.

## Accessibility & Inclusion

- WCAG 2.2 AA. The current build passes axe with no violations, and the redesign must not regress.
- Keyboard-first review with visible focus.
- Screen-reader announcements for desk actions.
- Live updates can be paused (WCAG 2.2.2).
- `prefers-reduced-motion` is respected.
- Light and dark themes, where Theme is set to "Match my computer" by default.
