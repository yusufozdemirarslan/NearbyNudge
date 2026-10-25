# Design review

The working files for the NearbyNudge redesign:
- `shoot.mjs`: the screenshot script.
- `directions.html` and `DIRECTIONS.md`: the three proposed directions.
- `before/` and `after/`: the screenshots. Both folders are gitignored.

Product facts live in [`../PRODUCT.md`](../PRODUCT.md).

## Taking screenshots

```
node design-review/shoot.mjs before              # every screen into design-review/before/
node design-review/shoot.mjs after desk sent     # just these screens into design-review/after/
node design-review/shoot.mjs list                # the screen names
```

- **What it shoots:** every screen at 1440px and 390px wide, as full-page PNGs. It waits until the data and fonts have loaded. The key screens are also shot in dark mode.
- **Where it runs:** the script starts its own copy of the dashboard in sample-data mode (`vite --mode mock`) on port 5310.
  - That copy holds the sample campaign in browser memory, with no backend.
  - Anything the script clicks only changes that memory, and it is thrown away when the script ends.
  - The script never connects to the real app on port 8000.
- **Requirements:** Playwright and its Chromium are already dev dependencies of `frontend/`. Run `npm install` there first if `node_modules` is missing.

## Phase 1: what the app is

The full record is in `PRODUCT.md`.

**What it does:** NearbyNudge finds real businesses near a place, such as dentists within 5 miles of Arlington, VA. It reads each one's own website, picks a specific reason to reach out, and drafts a short email in which every claim about the business points to the page it came from. An editor pass checks each draft before a person sees it.

**Who uses it:** the founder or sales lead of a small B2B service firm, such as an ads agency. They sit at a desk next to their own email app and clear 10–20 drafts in one sitting, mostly with the keyboard.

**The main job:** turn "who I sell to, where, and what I offer" into emails worth sending. Then review each one, approve it, send it from their own account and log replies.

**Right now:** the app is also a live demo in front of an audience. There is no sign-in.

### Screens, and the states captured in `before/`

| Screen | Route | States |
|---|---|---|
| Set up your sender profile | `/onboarding` | Empty form, light and dark |
| Campaigns | `/` | Three campaigns (one still researching); paused banner; first run, with the campaign form embedded |
| New campaign | `/campaigns/new` | The brief; the plan with its one question |
| Review desk | `/campaigns/:id` | See the list below |
| Sent | `/sent` | All emails; empty |
| Numbers | `/numbers` | Populated; empty |
| Do not contact | `/dnc` | Populated; empty |
| Settings | `/settings` | Sender profile, preferences, usage, delete all data |
| Admin | `/admin` | AI status, spend, balance, quality audit, errors, AI calls, opt-outs |
| NearbyNudgeBot | `/bot` | Includes the opt-out form |
| Data sources, Privacy, Terms | `/data-sources`, `/privacy`, `/terms` | |
| Not found | any unknown path | |
| Overlays | | Command menu (Ctrl/⌘ K); keyboard shortcuts (?) |

**Review desk states captured:**
- a ready draft, in three columns on desktop;
- the list and a single lead on a phone;
- dark mode;
- the sending preview, and the same preview at the daily cap;
- skip reasons;
- a draft that needs review;
- a lead still being researched;
- a lead that couldn't finish;
- a finished campaign.

**Not captured, because the sample data can't produce them:**
- the root error page;
- a paused or failed campaign;
- a few rare plan errors.

### Main flows

1. **First run.** Open the app, set up the sender profile (name, company, postal address), then land on New campaign.
2. **Start a campaign.**
   - Fill in where, who, the offer, an optional proof point, the ask, tone and how many businesses.
   - Choose Review plan. The AI restates the plan and asks at most one question.
   - Choose Find *N* businesses. The desk fills in live as each business is read, scored, written and checked.
3. **Review.** On the desk, move with J/K, read the draft and its sources, then:
   - approve (A);
   - edit (E) or rewrite it shorter, friendlier, more direct, or with another hook (1–4);
   - skip with a reason (S);
   - or mark the business do not contact (Shift+D, which asks first).
4. **Send (a proof of concept).**
   - Approving opens the sending preview.
   - From there, open the email in your own email app (O) or copy it (C), then mark it as sent (M). Undo is Z.
   - Log replies later on Sent.
5. **Look back.** Numbers shows this week against last week, the funnel, and figures by campaign and by week. Sent is the log.
6. **Keep lists clean.**
   - Do not contact: add, search, remove, undo.
   - Site-owner opt-outs: in Admin, and through the public `/bot` page.
7. **Set up and reset.**
   - Settings: profile, preferences, usage, and delete all data, which starts over.
   - Admin: AI health, spend and quality.

### What the current look gets wrong

**It is a stock component-kit admin.** Every screen has:
- a pale blue-grey page;
- white rounded panels with 1px borders;
- one teal accent;
- line icons;
- Atkinson Hyperlegible everywhere.

It is tidy and accessible, and it could be any SaaS tool.

**AI-generated tells on screen today:**
- Stat cards on Numbers and Admin: a big number, a small label and an arrow showing the change.
- Identical rounded cards: Numbers' weekly charts and Admin's spend tiles.
- Meta joined with middle dots, such as "Created Oct 25 · 10 businesses" and "1.2 mi · Email · Ready".
- Icons in tinted tiles, in empty states and in the brand mark.
- "↗" tacked onto every source link.
- Key-hint chips on every button.
- "Sent today" printed twice on the same screen, in the top bar and in the page header.

**What is worth keeping, in substance:**
- the claim-to-source numbers in each draft;
- the evidence column with the site check;
- the keyboard-first action bar;
- the always-visible daily cap;
- the plain, honest copy.
