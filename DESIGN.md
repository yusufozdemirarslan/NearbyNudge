# NearbyNudge design: Criss-cross

The look of NearbyNudge, and the rules for keeping it. Product facts live in [PRODUCT.md](PRODUCT.md). The directions this was chosen from are in [design-review/DIRECTIONS.md](design-review/DIRECTIONS.md).

## The idea

Before the web, salespeople found every business on a street in the criss-cross city directory. NearbyNudge prints a fresh one for each campaign:
- every business in range, set as a white-pages entry;
- what it says about itself, with its sources set as footnotes;
- beneath it, the letter worth sending.

What this refuses is the SaaS dashboard made of soft cards, tinted panels and icon tiles.

## Principles

1. **Two inks on white: black and edge red.** The night version reverses them.
   - Red means one of two things: *here* (the open tab, the open entry, the current page) or *needs you* (a questioned claim, the daily cap, an error, a destructive confirmation).
   - There is no grey text. Weight, width, size and italic carry the hierarchy.
2. **Every list is a directory.** An entry is a white-pages line: name, dot leader, number. Details read like a directory listing, in short sentences separated by full stops, never by middle dots.
3. **Navigation is a thumb index.** Views and sections are die-cut tabs. The open tab is red.
4. **Sources are footnotes; checks are keys.** Claims carry superscript numbers, and the site check is a key with dot leaders.
5. **Spend boldness once per screen.** The running head and the thumb index are loud. Everything else is quiet black type on white.
6. **Corners are square,** except where paper is die-cut (tabs) and where a circle means a dot.
7. **One motion: filing.** It is described below. Nothing else moves except to show a state change.

## Tokens

All tokens live in `frontend/src/index.css`. Components use the Tailwind utilities generated from them, never raw values.

### Colour

| Token | Light | Dark | Use |
|---|---|---|---|
| `paper` | `#FFFFFF` | `#000000` | Page and surfaces |
| `ink` | `#000000` | `#FFFFFF` | All text, rules, primary buttons, focus ring |
| `edge` | `#C8102E` | `#FF5C61` | *Here* and *needs you*. 5.9:1 on white; 7.0:1 on black |
| `edge-ink` | `#FFFFFF` | `#000000` | Text on `edge` |
| `ink-soft` | `#6B6B6B` | `#9A9A9A` | Placeholders and disabled text only (5.3:1 and 7.5:1) |
| `tint` | `#F2F2F2` | `#161616` | A light tint of ink, like a printer's halftone screen: row hover, code boxes, disabled fills |
| `leader` | `#A6A6A6` | `#6B6B6B` | Dot leaders and dotted tracks only, never text |
| `hairline` | `#D9D9D9` | `#333333` | Row separators |

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

**Charts** use `ink` for data, `edge` for the current or highlighted item, and `leader` for context series.

### Type

Archivo Variable is the only family. It is self-hosted (`@fontsource-variable/archivo`, width axis 62–125%, weight 100–900, with italics).

| Utility | Size / line | Set as | Used for |
|---|---|---|---|
| `text-micro` | 12/16 | Normal | Key hints, chart axes |
| `text-meta` | 13/18 | Italic | Asides: the second line of an entry, hints, dates |
| `text-ui` | 14/20 | Normal | Controls, table cells, entry names |
| `text-body` | 16/26 | Normal | Letters and prose |
| `text-lead` | 18/26 | 600 | Email subjects and h3 |
| `text-head` | 24/26 | Extra-condensed 800 | Section heads (h2), sentence case |
| `text-title` | 36/34 | Extra-condensed 800, caps | Running heads (h1) |
| `text-display` | 48/44 | Extra-condensed 800, caps | The open entry on the desk; big numbers |

- `.stretch-condensed` sets `font-stretch: 62.5%`. Numbers in columns use `tabular-nums`.
- Caps are only ever the heading itself, set solid. They are never a tracked-out label above a heading.
- Measure: letters and prose stay under 68ch.

### Space, size and shape

- **Spacing:** Tailwind's 4px scale.
- **Layout constants:**
  - masthead height `--masthead` 56px;
  - page gutter 24px, or 16px under 640px;
  - heavy rule 3px under running heads and the masthead;
  - column rules 1px ink.
- **Radius:** 0 everywhere. The exceptions are `rounded-tab` (10px, the die-cut outer corners of thumb tabs) and `rounded-full` (dots and radio buttons).
- **Elevation:**
  - Pages are flat.
  - Overlays (menus, popovers, dialogs, toasts) are paper with a 1px ink border and `shadow-overlay`, which is offset with a soft blur, like a slip of paper lying on the page.
  - The dialog backdrop is paper at 72% opacity.

### Motion

| Token | Value | Use |
|---|---|---|
| `--dur-fast` | 120ms | Hover and press |
| `--dur-state` | 200ms | State changes, overlays |
| `--dur-file` | 380ms | The filing move |
| `--motion-ease` (Tailwind `ease-out`) | `cubic-bezier(0.16, 1, 0.3, 1)` | Everything |

Under `prefers-reduced-motion`, or with live updates paused, nothing moves and every state change lands at once.

## The signature

### The thumb index

The status views of the review desk are die-cut tabs on the list's outer edge, the way a directory is cut for A–Z:
- each tab shows its count in condensed numerals;
- the open tab is edge red, and the others are ink;
- the labels run up the tab on desktop;
- on phones, the tabs run along the top edge.

The same tab grammar, horizontal, serves Sent's filters and the in-page sections of Settings and Admin. Only the desk cuts the tabs into the side edge; on phones the desk's tabs run along the top and scroll sideways.

### The white-pages line

`Sample Dental Studio ··········· 92`: the name in bold, then a dotted leader, then the number that matters (fit, count or date) in condensed tabular numerals. The second line is an italic aside: *dentist, email on file*, with the distance on the right.

- **The open entry:** its name is set in edge red, with a small drawn pointer in the gutter.
- **Hover:** the name is underlined.

### Filing

When you approve, skip, mark as sent or mark do not contact:
1. The entry's status line is struck through with a red rule.
2. The new status is set in its place.
3. The tab the entry now belongs to ticks its count up once.

This takes `--dur-file`. It is the only authored motion in the app.

## Components and their states

**Every interactive control has these states:**
- **hover:** text is underlined, or a row takes the `tint`;
- **focus:** a 2px ink outline with a 2px offset (inset inside scrolling lists);
- **active:** it presses down 1px;
- **disabled:** `ink-soft` text, dashed border, `not-allowed` cursor;
- **loading:** the label changes to its "-ing" form and a three-dot leader runs.

### Buttons

| Variant | Look | Use |
|---|---|---|
| Primary | Ink fill, paper text | The one main action in a place |
| Outline | 1.5px ink border | Secondary actions |
| Ghost | No border | Tertiary actions; underlined on hover |
| Edge | Edge fill, paper text | A confirmed destructive step |
| Edge outline | Dashed edge border | Destructive actions that should stand apart |
| Link | Ink text, underlined | Links |

- Key hints sit inside the button as a small square outlined in the label's colour, with the key's letter.
- Rules: buttons and toggles use 2px ink; fields, overlays and notices use 1px (1.5px renders unevenly at 1x).
- **Do not contact** stays out of the main row: it lives in the desk's More menu (or Shift+D) and always asks first, with the confirm set in edge red.
- Sizes: sm 32px, default 40px, lg 44px. Every touch target is at least 44px on phones.
- The press nudge is `transform: translateY(1px)`, never the `translate` property, so a button placed with `-translate-y-1/2` doesn't jump out from under the pointer.

### Form controls

- **Inputs, textareas and selects:** square, 1px ink border, 40px tall.
  - Placeholders are italic `ink-soft`.
  - An error turns the border edge red, with the message underneath in red beside a drawn mark.
- **Checkbox:** a 2px square that fills with ink when checked.
- **Radio:** a circle.
- **Switch:** a square track whose knob slides; it is ink-filled when on.
  - In a settings list each switch ends a white-pages line, "Live updates ······ On [switch]": the word On or Off sits beside it in condensed bold, so the state never rests on fill alone.
- **Radio cards:** square boxes with a 1px ink border; the chosen one takes a 2px inset ink outline and a filled radio.
- **Toggle chips** (the industry suggestions): 32px square chips with a hairline border that darkens to ink on hover; a pressed chip inverts to ink with a drawn check. They stay buttons with `aria-pressed`.
- **Forms:** no card around them. A bold label column (7.5rem on desktop, stacked on phones) sits beside each field, and hints run underneath as italic asides. Sections of a long form are ruled off with a 2px ink rule and a condensed head.

### Data and status

- **Tables:**
  - There is no outer box.
  - Column heads are condensed bold, in sentence case, above a 2px ink rule.
  - Rows are separated by hairlines.
  - Numbers are right-aligned and tabular.
- **Status marks:** a drawn 12px mark plus the word, always both.
  - queued: a ring
  - working stages (reading, choosing, writing, checking): a dot, with "step 2 of 4" in italic
  - ready: a solid square
  - needs review: an edge-red asterisk, with the word in red
  - approved: a check
  - sent: a tick on a rule
  - replied: a return mark
  - skipped: a slash
  - do not contact: an edge-red barred circle
  - couldn't finish: a cross
- **Fit:** the word and the number, as in "Strong fit 92". The number uses one weight ramp everywhere: Strong 800, Good 600, Weak 400.
- **Meters:**
  - The daily cap is "Sent today 7 of 20" over a dotted leader track filled with solid ink.
  - At the cap, the fill and numbers turn edge red.
  - Every meter shows its value in words.

### Feedback and overlays

- **Notices:** boxed with a 1px ink rule.
  - A notice that needs you carries a 3px edge rule across its top and a condensed head.
  - Notices never sit on a tinted background.
- **Empty states:** a condensed head, one sentence about what will fill the space, and the action that fills it. There is no icon tile.
- **Toasts:** a paper slip with an ink border and `shadow-overlay`, a bold title, a sentence and an Undo button, placed bottom right above the desk's action strip.
  - The kind shows as a drawn mark: a check (done), a dot (for your information), an edge-red asterisk (warning) or an edge-red cross (error); a three-dot leader while something runs.
- **The footer slip (Onboarding and Settings):** the locked email footer, set at reading size (16/26) in a 2px ink frame with a drawn lock and "Locked" above it. It fills in as you type; empty lines show their placeholders in italic `ink-soft`. It is those pages' one bold element.
- **Danger zone (Delete all data):** a notice with an edge-red 3px top rule, the confirm field and the edge-red destructive button. No pink wash.
- **The ledger (Sent):** the status filters are a horizontal thumb index along the top of the table, each tab carrying its count in condensed numerals (24px on desktop, 18px on phones); the open filter is edge red. The table has no box. Logging a reply is a choice of underlined words, "Replied? Interested  No thanks  Other", not three more boxed buttons per row; only the approved rows carry real buttons. On phones each email is a white-pages entry with 44px buttons.
- **Jump lists** (Settings sections): bold links in a row; the current one is underlined in edge red, like the masthead.
- **The plan (New campaign):** a notice with a 3px ink top rule.
  - A small boxed "AI" tag, then "Claude's plan:" in bold and the restatement in italic quotes.
  - Categories are white-pages lines, "General dentistry ······ 38".
  - The match count is set in display numerals: the page's one bold number.
  - A stale plan says so in edge red across the top of the notice, with Review plan again beside it.
- **Dialogs and sheets:** overlay style, with titles in `text-head`.
- **Menus:** entries run "Label ······ shortcut".
- **Command menu and shortcut sheet:** both are directory keys, "Next lead ······ J".
- **Loading:** dotted leader lines in the shape of the content. There are no grey bars and no spinners inside content.

### Charts

- Ink bars on a 1px ink baseline, with no gridlines.
- The current week or highlighted item is edge red.
- Labels are direct, in condensed numerals, rather than a legend.
- Every chart keeps its table view.

## Layout

- **Masthead (every app page):**
  - the NEARBYNUDGE wordmark in condensed caps;
  - the main navigation, where the current page gets a 3px edge underline;
  - "Sent today" and the monthly allowance;
  - the Options menu, showing the sender's name.

  On phones it shrinks to the wordmark, the daily count and a Menu button that opens the index as a sheet.
- **Running head (every page):**
  - the h1 in `text-title` caps on the left;
  - one fact or the page actions on the right;
  - a 3px ink rule underneath;
  - one plain sentence under the rule.
- **Review desk:** thumb index (44px), then the list (340px), then the open entry, then the footnotes and site check (300px).
  - At 840–1279px the footnotes move under the letter.
  - Under 840px the list fills the screen, and opening a lead shows it alone.

## Copy

- Sentence case and plain verbs.
- Every action keeps one name through its flow: Approve leads to Approved, and Mark as sent leads to Marked as sent.
- No arrows on links or buttons, and no middle dots in meta. Directory punctuation (full stops and commas) does that job.
- Errors say what happened and what to do next.
- Empty states name the next action.
