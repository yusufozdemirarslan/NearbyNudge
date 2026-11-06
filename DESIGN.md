---
name: NearbyNudge
description: A criss-cross city directory printed fresh for each campaign.
colors:
  paper: "#FFFFFF"
  ink: "#000000"
  edge: "#C8102E"
  edge-ink: "#FFFFFF"
  ink-soft: "#6B6B6B"
  tint: "#F2F2F2"
  leader: "#A6A6A6"
  hairline: "#D9D9D9"
  paper-night: "#000000"
  ink-night: "#FFFFFF"
  edge-night: "#FF5C61"
  edge-ink-night: "#000000"
  ink-soft-night: "#A6A6A6"
  tint-night: "#161616"
  leader-night: "#6B6B6B"
  hairline-night: "#333333"
typography:
  display:
    fontFamily: "Archivo Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "48px"
    fontWeight: 800
    lineHeight: "44px"
    fontVariation: "'wdth' 62.5"
  title:
    fontFamily: "Archivo Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "36px"
    fontWeight: 800
    lineHeight: "34px"
    letterSpacing: "0.004em"
    fontVariation: "'wdth' 62.5"
  head:
    fontFamily: "Archivo Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 800
    lineHeight: "26px"
    fontVariation: "'wdth' 62.5"
  lead:
    fontFamily: "Archivo Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: "26px"
  body:
    fontFamily: "Archivo Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "26px"
  ui:
    fontFamily: "Archivo Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  meta:
    fontFamily: "Archivo Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "18px"
  micro:
    fontFamily: "Archivo Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
rounded:
  none: "0px"
  tab: "10px"
  full: "9999px"
spacing:
  unit: "4px"
  gutter-phone: "16px"
  gutter: "24px"
  gutter-wide: "40px"
  masthead: "56px"
  rule-heavy: "3px"
  measure: "68ch"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.ui}"
    rounded: "{rounded.none}"
    padding: "0 16px"
    height: "40px"
  button-outline:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.ui}"
    rounded: "{rounded.none}"
    padding: "0 16px"
    height: "40px"
  button-ghost:
    textColor: "{colors.ink}"
    typography: "{typography.ui}"
    rounded: "{rounded.none}"
    padding: "0 16px"
    height: "40px"
  button-ghost-hover:
    backgroundColor: "{colors.tint}"
  button-edge:
    backgroundColor: "{colors.edge}"
    textColor: "{colors.edge-ink}"
    typography: "{typography.ui}"
    rounded: "{rounded.none}"
    padding: "0 16px"
    height: "40px"
  button-edge-outline:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.edge}"
    typography: "{typography.ui}"
    rounded: "{rounded.none}"
    padding: "0 16px"
    height: "40px"
  button-link:
    textColor: "{colors.ink}"
    typography: "{typography.ui}"
    padding: "0"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.ui}"
    rounded: "{rounded.none}"
    padding: "4px 12px"
    height: "40px"
  thumb-tab:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.ui}"
    rounded: "{rounded.tab}"
    padding: "0 16px"
    height: "36px"
  thumb-tab-open:
    backgroundColor: "{colors.edge}"
    textColor: "{colors.edge-ink}"
  tooltip:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.micro}"
    rounded: "{rounded.none}"
    padding: "6px 10px"
---

# Design System: NearbyNudge

The look of NearbyNudge, and the rules for keeping it. Product facts live in [PRODUCT.md](PRODUCT.md). The directions this was chosen from are in [design-review/DIRECTIONS.md](design-review/DIRECTIONS.md). All tokens live in `frontend/src/index.css`; components use the Tailwind utilities generated from them, never raw values.

## Overview

**Creative North Star: "The criss-cross directory"**

Before the web, salespeople found every business on a street in the criss-cross city directory. NearbyNudge prints a fresh one for each campaign:
- every business in range, set as a white-pages entry;
- what it says about itself, with its sources set as footnotes;
- beneath it, the letter worth sending.

What this refuses is the SaaS dashboard made of soft cards, tinted panels and icon tiles.

**Key Characteristics:**

1. **Two inks on white: black and edge red.** The night version reverses them.
   - Red means one of two things: *here* (the open tab, the open entry, the current page) or *needs you* (a questioned claim, the daily cap, drafts waiting, an error, a destructive confirmation).
   - There is no grey text. Weight, width, size and italic carry the hierarchy.
2. **Every list is a directory.** An entry is a white-pages line: name, dot leader, number. Details read like a directory listing, in short sentences separated by full stops, never by middle dots.
3. **Navigation is a thumb index.** Views and sections are die-cut tabs. The open tab is red.
4. **Sources are footnotes; checks are keys.** Claims carry superscript numbers set tight against the sentence's last mark, and the site check is a key with dot leaders.
5. **Spend boldness once per screen.** The running head and the thumb index are loud. Everything else is quiet black type on white.
6. **Corners are square,** except where paper is die-cut (tabs) and where a circle means a dot.
7. **One authored motion: filing.** It is described under Components. Everything else that moves only shows a state: work in progress, something loading, a row that just arrived.

## Colors

Two inks on paper, with a few screens of ink for structure. The night version swaps paper and ink and lifts the red so it keeps its contrast.

| Token | Light | Dark | Use |
|---|---|---|---|
| `paper` | `#FFFFFF` | `#000000` | Page and surfaces |
| `ink` | `#000000` | `#FFFFFF` | All text, rules, primary buttons, focus ring |
| `edge` | `#C8102E` | `#FF5C61` | *Here* and *needs you*. 5.9:1 on white; 7.0:1 on black |
| `edge-ink` | `#FFFFFF` | `#000000` | Text on `edge` |
| `ink-soft` | `#6B6B6B` | `#A6A6A6` | Placeholders, disabled text and facts marked wrong only (5.3:1 and 8.6:1) |
| `tint` | `#F2F2F2` | `#161616` | A light screen of ink, like a printer's halftone: row hover, the active footnote's fact, code boxes, disabled fills |
| `leader` | `#A6A6A6` | `#6B6B6B` | Dot leaders, dotted tracks and scrollbars only, never text |
| `hairline` | `#D9D9D9` | `#333333` | Row separators |

### Primary
- **Ink** (`ink`): every word, every rule, the primary button and the focus ring.

### Secondary
- **Edge red** (`edge`): *here* and *needs you*, nothing else. The text caret is edge red.

### Neutral
- **Paper** (`paper`), **Halftone** (`tint`), **Leader grey** (`leader`), **Hairline** (`hairline`) and **Soft ink** (`ink-soft`), each limited to the uses in the table.

**How the shadcn variables map:**

| shadcn variable | Maps to |
|---|---|
| `background`, `card`, `popover`, `secondary` | paper |
| `foreground` | ink |
| `primary` | ink (with paper text) |
| `muted`, `accent` | tint |
| `muted-foreground` | ink (secondary text is italic, not grey) |
| `destructive` | edge |
| `border` | hairline |
| `input` | ink |
| `ring` | ink |
| `chart-1` / `chart-2` / `chart-3` | ink / edge / leader |

**Charts** use `ink` for data, `edge` for the current or highlighted item, and `leader` for context series.

### Named Rules

**The Two Inks Rule.** Black and edge red on white, reversed at night. A new colour needs a new meaning, and there isn't one.

**The No Grey Text Rule.** `ink-soft` is for placeholders, disabled labels and facts the reviewer marked wrong. Anything else that wants to be quieter is set in italic.

**The No Pink Rule.** Edge red is never screened into a tint (the One Step brand forbids a pink wash). Selected text prints in reverse, paper on ink; a row that just arrived fades from the ink halftone (`tint`).

## Typography

**Display Font:** Archivo Variable (with ui-sans-serif, system-ui)
**Body Font:** Archivo Variable
**Label/Mono Font:** none; numbers use Archivo's tabular figures

**Character:** One family doing every job by width. Extra-condensed black caps (width 62.5%) are the directory's running heads; normal width sets entries and letters; italic sets the asides. It is self-hosted (`@fontsource-variable/archivo`, width axis 62–125%, weight 100–900, with italics), so no font service is contacted.

### Hierarchy

| Utility | Size / line | Set as | Used for |
|---|---|---|---|
| `text-micro` | 12/16 | Normal; 800 condensed for numerals | Key hints, footnote numerals, tooltips, menu shortcuts, chart axes |
| `text-meta` | 13/18 | Italic (`aside`) | Asides: the second line of an entry, hints, dates; status words in lists |
| `text-ui` | 14/20 | Normal; 600 for buttons, tabs and nav | Controls, table cells, entry names (bold) |
| `text-body` | 16/26 | Normal | Letters and prose; input text on phones |
| `text-lead` | 18/26 | 600 | Email subjects, h3, campaign names, numbers on list lines |
| `text-head` | 24/26 | Extra-condensed 800 (`section-head`) | Section heads (h2), dialog and sheet titles, sentence case |
| `text-title` | 36/34 | Extra-condensed 800 caps (`running-head`) | Running heads (h1); the open entry's name under 1280px |
| `text-display` | 48/44 | Extra-condensed 800 | The open entry's name (caps) and its fit at 1280px and up; the page's one big number |

- `stretch-condensed` sets `font-stretch: 62.5%`. `numeral` is 800, condensed, tabular lining figures: every number that matters uses it.
- Footnote numerals are 12px condensed 800, superscript, underlined, set tight against the sentence.
- Measure: letters and prose stay under 68ch (`max-w-measure`).

### Named Rules

**The Solid Caps Rule.** Caps are only ever the heading itself, set solid (0.004em). They are never a tracked-out label above a heading.

**The Fit Weight Rule.** A fit number's weight says how strong it is, everywhere: Strong 800, Good 600, Weak 400. The word carries the meaning; the weight echoes it.

## Layout

- **Spacing:** Tailwind's 4px scale.
- **Page container:** 1152px wide pages or 768px narrow pages, centred. The gutter is 16px under 640px, 24px from 640px and 40px from 1024px; pages open 28px from the masthead (40px from 1024px).
- **Rules:** masthead height `--masthead` 56px; heavy rule `--rule-heavy` 3px under running heads and the masthead; column rules 1px ink.
- **Masthead (every app page):**
  - the brand: the One Step mark at 32px, then NEARBYNUDGE in 28px condensed caps (see Brand). Where the inline navigation leaves no room (1024–1439px) and under 360px the mark stands alone, and its link keeps the name;
  - the main navigation in 14px semibold, where the current page gets a 3px edge bar sitting on the heavy rule;
  - "Sent today" as a small meter; the monthly allowance joins it at 1280px and up;
  - the Options menu, showing the sender's name.

  Under 1024px the navigation folds into a Menu button that opens the index as a sheet from the left: each page a 24px condensed caps line on a hairline, the current one in edge red. Under 640px the daily meter keeps its numbers and drops its track.
- **Running head (every page):**
  - the h1 in `running-head` caps on the left;
  - one fact or the page actions on the right, staying beside the head on phones (the head wraps between words instead; only when its longest word and the actions can't share the line do the actions drop under it, still above the rule);
  - a 3px ink rule underneath;
  - one plain sentence under the rule, within 68ch.
- **Review desk:**
  - At 1280px and up: the list column (384px, its thumb index cut into the outer 40px), then the open entry, then the footnotes and site check (304px).
  - At 840–1279px the list column is 352px and the footnotes move under the letter.
  - Under 840px the list fills the screen with its tabs along the top, and opening a lead shows it alone.

## Brand

The identity is **One Step** (brand concept 04, approved): two large squares for nearby places and a small displaced square, the measured nudge. The handoff with its specification is kept outside the repository; everything the app needs is in it:
- `frontend/public/brand/nearbynudge/`: the supplied SVG marks, favicons (ICO, OS-aware SVG), touch and app icons, maskable icons, light, dark and one-ink variants.
- `frontend/src/components/shell/BrandMark.tsx`: `OneStepMark` (the inline symbol) and `BrandMark` (symbol and name).

**The drawing.** `viewBox="0 0 16 16"`, exactly three rectangles: ink at (1,1) and (9,9), 6 units square; edge red at (9,3), 3 units square. No rounding, stroke, rotation, outline, shadow, gradient or motion; never redrawn. Sizes are multiples of 16px so every square sits on whole pixels.

**Inks.** The mark reads `--nn-ink` and `--nn-edge`, bound in `index.css` to `ink` and `edge`, so it follows the theme the app applies: an explicit Light or Dark choice, or the system's. Light: black squares and `#C8102E` on white; dark: white squares and `#FF5C61` on black. One-ink versions use ink for all three squares. Under forced colours the mark draws in `CanvasText`.

**The name.** NearbyNudge, set visibly as NEARBYNUDGE in Archivo 800 at 62.5% width, caps, tracked -0.01em (`brand-name`): 28px beside the 32px mark, 12px apart (`BrandMark size="md"`); 14px beside the 16px mark, 6px apart (`size="sm"`). Archivo is the self-hosted variable font already in use (weight 100–900, width 62–125, roman and italic).

**Placements.**
- Masthead (every app page), the phone menu, public pages, dead ends and the set-up screen: `BrandMark` at md.
- Public and set-up footers: `BrandMark` at sm, before the links.
- Constrained places show the mark alone (the masthead at 1024–1439px and under 360px).

**Accessibility.** Beside the readable name the mark is decorative (`aria-hidden`), so the name isn't announced twice. A link that may show the mark alone carries the name (`aria-label="NearbyNudge, campaigns"`, "NearbyNudge home"). Its focus ring is the usual 2px ink outline, 4px clear of the squares.

**Icons and metadata.** `index.html` links `favicon.ico` (16/32/48), the OS-aware `favicon.svg` (it follows the browser's own scheme, like the tab strip it sits on) and the 180px touch icon; `/favicon.ico` at the root is the same light icon for clients that ask for it unprompted. `application-name` and `apple-mobile-web-app-title` name the app. `theme-color` follows the app's theme, an explicit choice included. There is no web app manifest, so the install and maskable icons are on hand but unused.

## Elevation & Depth

Pages are flat; depth is a rule, not a shadow. Overlays (menus, popovers, hover cards, dialogs, sheets, toasts, the location list and chart tooltips) are paper with a 1px ink border and `shadow-overlay`, offset with a soft blur, like a slip of paper lying on the page. Dialogs and sheets lie over a paper backdrop at 72% opacity.

### Shadow Vocabulary
- **Overlay slip** (`box-shadow: 0 22px 44px -20px var(--shadow-color), 0 2px 6px -2px var(--shadow-color)`; the shadow colour is black at 38%, or 90% at night): every overlay, and nothing else.

### Named Rules

**The Flat Page Rule.** Nothing on the page itself casts a shadow. Grouping is done with rules: 3px for running heads and notices, 2px for sections and frames, 1px for boxes and columns, hairlines between rows.

## Shapes

- **Radius:** 0 everywhere. The exceptions are `rounded-tab` (10px, the die-cut outer corners of thumb tabs) and `rounded-full` (radio buttons and their dots).
- **Rules:** buttons, toggles, checkboxes and frames use 2px ink; fields, overlays and notices use 1px (1.5px renders unevenly at 1x).
- **Dashes:** a dashed border means one of two things: disabled, or a destructive action standing apart (edge). A live form is never dashed.
- **Drawn marks** (`Mark`): 12px glyphs on a 12-unit grid, one 1.75 stroke, square caps and mitred joins, in the current colour. They stand beside a word, never instead of one: ring, dot, square, asterisk, check, envelope, reply, slash, barred circle, cross, pointer, pause, lock.
- **Utility icons:** Lucide at the same 1.75 stroke, 18px in buttons (16px in small ones), only for controls with no word of their own job to do: chevrons, close, plus, search, menu, copy, download, undo, edit. Meaning is always a drawn mark plus a word.

## Components

### Every interactive control

- **hover:** text is underlined, or a row takes the `tint`;
- **focus:** a 2px ink outline with a 2px offset (inset inside scrolling lists, `focus-inset`);
- **active:** it presses down 1px;
- **disabled:** `ink-soft` text, dashed border, `not-allowed` cursor;
- **loading:** the label changes to its "-ing" form and a three-dot leader runs.

### Buttons

Square, semibold 14px, with a 2px rule.

| Variant | Look | Hover | Use |
|---|---|---|---|
| Primary | Ink fill, paper text | Underline | The one main action in a place |
| Outline | 2px ink border on paper | Underline | Secondary actions |
| Ghost | No border | Takes the `tint` | Tertiary actions and icon buttons |
| Edge | Edge fill, `edge-ink` text | Underline | A confirmed destructive step |
| Edge outline | 2px dashed edge border, edge text | Underline | Destructive actions that should stand apart |
| Link | Ink text, 1px underline | Turns edge red | Links |

- Sizes: xs 28px, sm 32px, default 40px, lg 44px; square icon buttons match. Every touch target is at least 44px on phones.
- Key hints sit inside the button as a 20px square outlined in the label's colour, with the key in 12px condensed 800.
- **Do not contact** stays out of the main row: it lives in the desk's More menu (or Shift+D) and always asks first, with the confirm set in edge red.
- The press nudge is `transform: translateY(1px)`, never the `translate` property, so a button placed with `-translate-y-1/2` doesn't jump out from under the pointer.

### Form controls

- **Inputs, textareas and selects:** square, 1px ink border, 40px tall (32px small). Text is 16px on phones, so iOS doesn't zoom, and 14px from 768px.
  - Placeholders are italic `ink-soft`, because a hint must never read as a typed value.
  - Disabled fields take the `tint` and a dashed border.
  - An error turns the border and outline edge red, with the message underneath in red beside a drawn mark.
- **Checkbox:** a 16px square with a 2px ink rule that fills with ink when checked, with a paper check.
- **Radio:** a 16px circle with a 2px ink rule and an ink dot.
- **Switch:** a square 36 × 20px track with a 2px ink rule whose square knob slides; on, the track fills with ink and the knob turns paper.
  - In a settings list each switch ends a white-pages line, "Live updates ······ On [switch]": the word On or Off sits beside it in condensed bold, so the state never rests on fill alone.
- **Radio cards:** square boxes with a 1px ink border; the chosen one takes a 2px inset ink outline and a filled radio.
- **Toggle chips** (the industry suggestions): 32px square chips with a hairline border that darkens to ink on hover; a pressed chip inverts to ink with a drawn check. They stay buttons with `aria-pressed`.
- **Option lists** (the location combobox): the highlighted option inverts to ink.
- **Forms:** no card around them. A bold label column (7.5rem on desktop, stacked on phones) sits beside each field, and hints run underneath as italic asides. Sections of a long form are ruled off with a 2px ink rule and a condensed head.

### Navigation: the thumb index

The status views of the review desk are die-cut tabs on the list's outer edge, the way a directory is cut for A–Z:
- each tab is 36px deep, drawn with a 2px ink rule on paper, open on the rule it stands on, its outer corners cut at 10px;
- each tab shows its count in condensed numerals, clear of the rounded end;
- the open tab is filled edge red with `edge-ink` text; hover underlines the label;
- on desktop the tabs are 40px wide and the labels run up the tab;
- under 840px the tabs run along the top edge and scroll sideways.

The same tab grammar, horizontal, serves Sent's filters and the in-page sections of Settings and Admin. Only the desk cuts the tabs into the side edge.

- **Jump lists** (Settings and Admin sections): bold links in a row; the current one is underlined in edge red, like the masthead.

### The white-pages line

`Sample Dental Studio ··········· 92`: the name in bold, then a dotted leader (2px dotted `leader`, at least 24px), then the number that matters (fit, count or date) in condensed tabular numerals. The second line is an italic aside: *dentist, email on file*, with the distance on the right.

- **The open entry:** its name is set in edge red, with a small drawn pointer in the gutter. It takes no fill.
- **Hover:** the name is underlined and the row takes the `tint`.
- **Still working:** the name drops to semibold until the entry is ready.

### Filing

When you approve, skip, mark as sent or mark do not contact:
1. The entry's status line is struck through with a 2px edge rule drawn from the left.
2. The new status rises into its place.
3. The tab the entry now belongs to ticks its count up once.

This takes `--dur-file` (380ms). It is the only authored motion in the app.

### Motion

| Token | Value | Use |
|---|---|---|
| `--dur-fast` | 120ms | Hover, press, menus and popovers |
| `--dur-state` | 200ms | State changes, dialogs, sheets, meters filling |
| `--dur-file` | 380ms | The filing strike and tick |
| `--motion-ease` (Tailwind `ease-out`) | `cubic-bezier(0.16, 1, 0.3, 1)` | Everything |

Besides filing, three things move, each only to show a state:
- the dot of a working stage pulses (1.6s);
- the three-dot leader runs while something loads (1.2s, in steps);
- a row that just arrived fades from the ink halftone (`tint`) to nothing (1.4s), once.

Under `prefers-reduced-motion`, or with live updates paused, nothing moves and every state change lands at once.

### Data and status

- **Tables:**
  - There is no outer box.
  - Column heads are condensed bold, in sentence case, above a 2px ink rule.
  - Rows are separated by hairlines.
  - Numbers are right-aligned and tabular.
- **Status marks:** a drawn 12px mark plus the word, always both. Ready and Needs review are set semibold, because they want a decision.
  - queued: a ring
  - working stages (reading, choosing, writing, checking): a pulsing dot, with "step 2 of 4" in italic
  - ready: a solid square
  - needs review: an edge-red asterisk, with the word in red
  - approved: a check
  - sent: an envelope, with the date
  - replied: a reply balloon, with the outcome
  - skipped: a slash, with the reason
  - do not contact: an edge-red barred circle, with the word in red
  - couldn't finish: a cross, with the reason
- **Fit:** the word and the number, as in "Strong fit 92", the number in 18px condensed under the Fit Weight Rule. On a list line it is the number alone; on the open entry it is 48px at the end of the name's leader.
- **Footnotes:** while a claim and its fact are active (the numeral focused, or the fact opened), the claim's numeral inverts to ink, and its fact in the footnotes takes the `tint` with its number inverted too. A fact marked wrong is struck through in `ink-soft`.
- **Meters:**
  - The daily cap is "Sent today 7 of 20" over a dotted leader track filled with solid ink.
  - At the cap, the fill and numbers turn edge red.
  - Every meter shows its value in words and is exposed as a meter or progress bar.
- **Campaigns:** each campaign is a directory entry, its name in 18px bold and its state as an aside. The page's bold number is the count of drafts waiting, set in edge red display numerals (36px on phones) before the sentence that names it; with nothing waiting the page says so in an aside.

### Feedback and overlays

- **Notices:** boxed with a 1px ink rule.
  - A notice that needs you carries a 3px edge rule across its top and a condensed head.
  - Notices never sit on a tinted background.
- **Empty states:** a condensed head, one sentence about what will fill the space, and the action that fills it. There is no icon tile.
- **Toasts:** a paper slip with an ink border and `shadow-overlay`, a bold title, an italic sentence and an Undo button, placed bottom right above the desk's action strip.
  - The kind shows as a drawn mark: a check (done), a dot (for your information), an edge-red asterisk (warning) or an edge-red cross (error); a three-dot leader while something runs.
- **Tooltips:** the one reversed overlay: an ink slip with paper text in 12px, with a small ink arrow and no shadow.
- **The AI label:** a 28px box with a 1px ink rule, "**AI** draft" with AI in condensed 800. It opens a popover saying how the draft was made: the pages read as directory lines with their dates, the checks as marks and words, the model as a definition pair.
- **The footer slip (Onboarding and Settings):** the locked email footer, set at reading size (16/26) in a 2px ink frame under a heading with a drawn lock. It fills in as you type; a value not given yet is a fill-in blank in ink, its name in italic followed by a dot leader; the business-offer sentence waits in italic without a leader, since it is a sentence, not a field. It is those pages' one bold element. Under a letter on the desk the same footer sits below a dashed leader rule.
- **Danger zone (Delete all data):** a notice with an edge-red 3px top rule, the confirm field and the edge-red destructive button. No pink wash.
- **The ledger (Sent):** the status filters are a horizontal thumb index along the top of the table, each tab carrying its count in condensed numerals (24px on desktop; on phones the four tabs share the width, each with its label over an 18px count, so every filter stays in view down to 320px); the open filter is edge red. The table has no box. Logging a reply is a choice of underlined words, "Replied? Interested  No thanks  Other", not three more boxed buttons per row; only the approved rows carry real buttons. On phones each email is a white-pages entry with 44px buttons.
- **The register (Do not contact):** each entry is a white-pages entry led by the edge-red barred circle: the name in 18px bold, the website and email as plain text beside each other, the reason as an aside, who added it and when in italic, and Remove as an underlined word. A removed entry stays in place with its name struck through in edge red (the filing strike) and Undo beside it.
- **The office pages (Admin):** facts as small definition pairs (italic label over the value); figures as key lines in a three-column grid; quality measures as lines with the value in condensed numerals and a status word; the balance forecast's days left in 36px numerals (the page's bold element). Audited leads open in place like desk entries: a drawn pointer that turns down and red when open, footnote numerals on each fact, the quote in italic behind a 1px ink rule. A pressed Supported inverts to ink; a pressed Not supported inverts to edge red.
- **Status words** (Admin): a drawn mark plus the word. Fine and waiting states stay ink (check, pause, ring); only what needs someone is edge red (asterisk, cross).
- **Front matter (Bot, Data sources, Privacy, Terms):** reading pages at 16/26 within 68ch, condensed section heads, ink list markers, ruled tables, links underlined in ink that turn edge red on hover. The exact lines a site owner copies (the user agent, the robots.txt lines) sit in a 2px ink frame with Copy as a word: those pages' bold element. The opt-out request is a ruled form (1px ink box under a 3px rule); once sent it becomes a receipt in a 2px ink frame.
- **Dead ends (not found, a crash):** the brand over the heavy rule, then the running head. Not found also shows the address that failed, struck through in edge red.
- **The plan (New campaign):** a notice with a 3px ink top rule.
  - A small boxed "AI" tag, then "Claude's plan:" in bold and the restatement in italic quotes.
  - Categories are white-pages lines, "General dentistry ······ 38".
  - The match count is set in display numerals: the page's one bold number.
  - A stale plan says so in a notice with an edge-red top rule, with Review plan again beside it.
- **Dialogs and sheets:** overlay style, with titles in `section-head`; a close button in the corner.
- **Menus:** entries run "Label ······ shortcut", the shortcut in 12px numerals; groups are split by a hairline.
- **Command menu and shortcut sheet:** both are directory keys, "Next lead ······ J". The selected command is marked like the open lead: a red pointer and its name in red, never a grey fill. The command field's heavy rule turns red while it has focus.
- **Loading:** dotted leader lines in the shape of the content. There are no grey bars and no spinners inside content.

### Charts and figures

- Ink bars on a 1px ink baseline, square, with no gridlines.
- The current week or highlighted item is edge red.
- Labels are direct, in condensed numerals, rather than a legend; the latest column carries the only label.
- Every chart keeps its table view. The switch is two words, Chart and Table; the pressed one is underlined in edge red.
- Chart blocks sit under a 2px ink rule with a condensed title; there are no chart cards.
- **Figures** (`StatTile`) are directory key lines, never tiles: "Found ······ 15", then the comparison and the all-time total as asides. On Numbers they run as one statistics key with the numbers in 36px condensed numerals on one right edge: the page's bold element. Up and down show as small drawn triangles beside the words.
- **The funnel** is four filled leader tracks, the same device as the meters: solid ink over a dotted rule, with the share of found as an aside.
- **Chart tooltips** are a paper slip with an ink border and `shadow-overlay`: the period in italic, the value in condensed numerals.

## Do's and Don'ts

### Do:
- **Do** set every list as white-pages lines: bold name, dot leader, condensed tabular number, italic aside beneath.
- **Do** keep edge red (#C8102E, #FF5C61 at night) for *here* and *needs you*, and nothing else.
- **Do** pair every drawn mark, meter and fill with a word, so colour and shape are never the only signal.
- **Do** give each screen one bold element besides the running head and the thumb index.
- **Do** separate with rules (3px, 2px, 1px, hairline) instead of boxes, fills or shadows.
- **Do** keep every touch target at least 44px on phones and every focus ring a 2px ink outline.

### Don't:
- **Don't** set text in grey; use italic for what is secondary.
- **Don't** put soft cards, tinted panels, icon tiles or a pink wash on the page.
- **Don't** round a corner other than a die-cut tab or a radio.
- **Don't** set a tracked-out caps label above a heading.
- **Don't** separate meta with middle dots or put arrows on links and buttons; full stops and commas do that job.
- **Don't** add motion beyond filing and the three state signals, and never let anything move under reduced motion or paused live updates.

## Copy

- Sentence case and plain verbs.
- Every action keeps one name through its flow: Approve leads to Approved, and Mark as sent leads to Marked as sent.
- Undo names what it undoes, in the message and on the desk alike: Undo approval, Undo skip, Undo do not contact, Undo mark as sent, Undo reply.
- A lead whose research ended without a fit says "Not scored"; a dotted blank only ever means "still coming".
- No arrows on links or buttons, and no middle dots in meta. Directory punctuation (full stops and commas) does that job.
- Errors say what happened and what to do next.
- Empty states name the next action.
