# Three directions for the redesign

**Decision (Oct 25): Criss-cross was built.** You asked me to decide. I had leaned towards Galley proof, but chose Criss-cross because it serves the main job best: going down a list of nearby businesses and deciding on each one. A directory is that list, and its tabs, dot leaders and footnotes carry the review desk's real structure (statuses, fit, sources) instead of decorating it. Galley proof's best idea, checking each claim against its source, survives as Criss-cross's footnotes. The system as built is in [DESIGN.md](../DESIGN.md).

Open [`directions.html`](directions.html) in a browser to see them. Each one is a mock-up of the review desk in its real colours and typefaces, using the sample campaign's own data.

## How they were found

**Where the ideas came from.** The visual language comes from the world NearbyNudge works in, not from app conventions:
- local selling and outreach;
- reading a business's own words;
- checking facts;
- sending letters.

I listed seven artifacts that this audience knows by heart and ranked them by how well they carry the product:
1. the fact-checker's galley proof;
2. the letter carrier's case and postmark;
3. the canvasser's walk sheet;
4. the salesperson's card file;
5. the criss-cross city directory;
6. Main Street shop signage;
7. the transit map.

**How the three were picked.** The Impeccable design skill then rolled dice to pick one of the seven. This keeps the result away from my own habits. It also dealt six outside "challenger" styles and tested each against the rolled direction on two things: whether the audience would recognise it, and whether it makes the product clearer.

**The result:**
1. **Criss-cross** is the rolled direction: number 5 on the list.
2. **Line diagram** is the strongest challenger, fused with the product.
3. **Galley proof** is my own first choice.

## 1. Criss-cross: the neighborhood directory

**Concept.** Before the web, salespeople found every business on a street in the criss-cross city directory. NearbyNudge prints a fresh one for each campaign: every business in range, in order, with what it says about itself and the letter worth sending.

**Palette**

| Name | Hex | Role |
|---|---|---|
| Directory white | `#FFFFFF` | The page |
| Ink | `#000000` | All text and the main buttons. Pure black on purpose, not a habitual near-black |
| Edge red | `#C8102E` | The open tab, the open entry and the current page. Contrast 5.9:1 on white |
| Leader grey | `#A6A6A6` | Dot leaders and column rules only, never text |
| Night red | `#FF5C61` | Edge red in dark mode: 7:1 on black |

Dark mode is a reversed directory page: white ink on black.

**Type.** Archivo is the only family. It is an American grotesque in the lineage of directory and newspaper gothics, and one variable font file covers every width:
- extra condensed black for running heads, thumb tabs and big numbers;
- normal width for entries and letters;
- italic for occupations, the way directories set their abbreviations.

**Layout.** Each screen is a directory page:
- the running head names the place;
- entries are white-pages lines;
- details read like a directory listing, in sentences separated by full stops;
- sources and the site check are footnotes and a dot-leader key.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ NEARBYNUDGE  Campaigns  New campaign  Sent  Numbers  Do not contact  Settings  Admin   │
│                                                                  Sent today  7 of 20  │
╞════╤═══════════════════════════╤═══════════════════════════════════╤════════════════════╡
│▐R▌ │ DENTISTS   ARLINGTON, VA. │ SAMPLE DENTAL STUDIO ··········92 │ SOURCES            │
│▐e▌ │ Within 5 miles. 4 of 9    │ Strong fit. Dentist. 1400 Example │ 1 About page, read │
│▐a▌ │ ready, still running.     │ Blvd, Arlington. 1.2 mi.          │   Oct 25. "Family  │
│▐d▌ │                           │ Why: books by phone only.         │   practice…"       │
│▐y▌ │ Ready                     │ ═════════════════════════════════ │ 2 Home page, …     │
│ N  │▌Sample Dental Studio ··92 │ Online booking at Sample Dental   │                    │
│ e  │  dentist, email    1.2 mi │ Studio?                           │ SITE CHECK         │
│ e  │ Sample Family Dental ··88 │ Hi Dr. Lee,                       │ Secure ······· yes │
│ d  │  dentist, form     2.0 mi │ …served Arlington since 2009.¹    │ Phones ········ no │
│ s  │ Needs review              │ …call your front desk to book.²   │ Booking ····· none │
│ ⋮  │ Sample Pediatric … ···84  │ [Approve A] [Skip S] [Rewrite 1]   ┊Do not contact┊     │
└────┴───────────────────────────┴───────────────────────────────────┴────────────────────┘
 thumb index   white-pages lines        the open entry, set as a listing    footnotes + key
```

**Signature element.** The thumb index. The status views (Ready, Needs review, In progress, Sent, All) are die-cut into the list's edge like the tabs on a directory:
- the open tab is red;
- the counts tick up as research lands;
- on a phone, the tabs run along the top edge.

**Motion.** One move only. When you approve, skip or send, the entry folds out of its section and the tab it went to ticks up once. Nothing else animates. With reduced motion, the entry simply moves.

**Raised by the challengers it beat.** Each declined challenger had one discipline worth taking:
- **Star atlas:** fit uses a single weight ramp everywhere (Strong heavy, Good medium, Weak light) and no badges.
- **Record sleeve:** only the open entry and the open tab are red, and nothing is labelled twice.
- **Developer console:** Do not contact stands alone, dashed, away from Approve.
- **Data field:** two inks only. There is no grey text; weight, width and italic do the work.

**Honest risk.**
- Square corners and ruled columns sit close to the broadsheet look that reads as AI-made. The directory's own devices (leaders, die-cut tabs, condensed heads) have to carry it.
- People under 40 know it as "the phone book", not by name.

## 2. Line diagram: the research line

**Concept.** Every campaign runs like a transit line. Each business boards at Found, stops at Reading, Choosing, Writing and Checking, and arrives at your desk. The diagram shows exactly where each one is. Stations are statuses, not places, so nothing pretends to be a map.

**Palette**

| Name | Hex | Role |
|---|---|---|
| Midnight enamel | `#0F1E3D` | Ground in dark mode, text in light mode |
| Porcelain | `#F4F6F5` | Enamel-plate white: text on midnight (15:1), and the light ground |
| Scarlet line | `#EF4B3B` | First campaign line |
| Cobalt line | `#5A88FF` | Second campaign line |
| Amber line | `#F5A623` | Third campaign line |
| Signal green | `#2DBE6C` | Fourth campaign line |

Every line colour clears 4.5:1 on midnight. The light mode uses deeper inks of the same four colours.

**Type.** Signika only: a humanist sans drawn for wayfinding signs. It is set in fixed sizes like station labels, in mixed case, with figures that line up.

**Layout.**
- **Review desk:** the campaign's line runs down the list, with businesses grouped under their station. The draft sits on a porcelain enamel plate.
- **Campaigns page:** the whole network. Every campaign is a line through the same stations, with counts at each stop.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ ◯ NearbyNudge   (D) Dentists, Arlington   (H) HVAC, Fairfax   (L) Law firms, Alexandria│
│                                             Sent today ●●●●●●●○○○○○○○○○○○○○   7 of 20 │
├──────────────────────────────┬─────────────────────────────────────┬─────────────────────┤
│ (D) Dentists, Arlington      │ ╭─────────────────────────────────╮ │ Where this came from│
│     Within 5 mi. Running.    │ │ Sample Dental Studio Strong fit 92│ │ (1) About page,     │
│  ●━ Ready ─────────────── 2  │ │ Dentist, 1.2 mi, samplestudio…   │ │     read Oct 25     │
│  ┃ ◉ Sample Dental Studio 92 │ │ ─────────────────────────────── │ │ (2) Home page, …    │
│  ┃ ○ Sample Family Dental 88 │ │ Online booking at Sample Dental… │ │                     │
│  ●━ Needs review ──────── 1  │ │ Hi Dr. Lee,                      │ │ Site check          │
│  ┃ ○ Sample Pediatric…    84 │ │ …since 2009 (1) …book a visit (2)│ │ Secure          Yes │
│  ●━ Writing ───────────── 1  │ │                                  │ │ Works on phones  No │
│  ┃ ○ Sample Orthodontics  81 │ ╰─────────────────────────────────╯ │                     │
│  ●━ Reading site ──────── 2  │ (Approve A) (Skip S) (Rewrite 1)     (Do not contact)     │
│  ○  Queued ────────────── 2  │                                     │                     │
└──────────────────────────────┴─────────────────────────────────────┴─────────────────────┘
  the campaign's line: stations     the draft on an enamel plate
  are statuses, dots are businesses
```

**Signature element.** The live line. While research runs, each business rides the line station by station, and the Sent today meter is twenty stops, seven of them filled.

**Motion.** When a business changes status, its dot glides along the line to the next station. With reduced motion, it simply appears there.

**From the product.**
- Lines take colours in a fixed order and keep them.
- A finished campaign goes grey.
- The route bullets are coloured circles on purpose: they are how each line is named.

**Honest risk.**
- It carries progress and status brilliantly but adds little to reading drafts and checking facts.
- A dark-first look needs a daylight version designed with equal care.

## 3. Galley proof: the fact-checker's desk (my first pick, not built)

**Concept.** Every draft is a galley proof on the fact-checker's desk. Each claim is marked against the line of the business's own website it came from, and nothing goes out until it is approved.

**Palette**

| Name | Hex | Role |
|---|---|---|
| Proof white | `#FFFFFF` | The page |
| Graphite | `#262A30` | Text. A deliberate pencil graphite at 14.4:1, not a habitual near-black |
| Blue pencil | `#1F5FBF` | Links, leader lines, focus and the open item. 6.1:1 |
| Red pencil | `#CC2E2E` | Only questioned claims and the approval mark. 5.3:1 |
| Highlighter | `#FFE45C` | Behind each supported claim |
| Margin grey | `#D5D9DE` | Rules, and the edge of the margin |

Dark mode is "proofing at night": graphite ground, pale text, a lighter blue pencil, and the highlighter shown as an underline instead of a fill.

**Type.**
- **Piazzolla** for everything you read: the draft, business names and headings. It is a sharp text serif made for newspapers, and it is always roman; there are no italic display headings.
- **Libre Franklin**, the newsroom gothic, for controls, labels and margin notes.

**Layout.**
- On the left, the proof queue, grouped by what needs you.
- In the centre, the draft set as a galley.
- On the right, the margin, with each source slip set level with the claim it supports.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ NearbyNudge  Campaigns  New campaign  Sent  Numbers  Do not contact  …   Sent today 7/20 │
├────────────────────────┬─────────────────────────────────────────────┬───────────────────┤
│ Ready to read, 2       │ Sample Pediatric Dentistry                  │                   │
│ Sample Dental Studio   │ Strong fit 84. Pediatric dentist, 2.6 mi.   │                   │
│ Sample Family Dental   │                                             │                   │
│                        │ Your second office, Sample Pediatric …      │                   │
│ Needs a second look, 1 │ Hi Dr. Patel,                               │                   │
│▌Sample Pediatric Dent. │ Your Home page says ░you care for kids from │                   │
│                        │ their first tooth to their teen years░¹ ────┼─ 1 Home page,     │
│ Still being            │ Congratulations on opening your second      │   read Oct 25     │
│ researched, 5          │ office this year.²?  ~~~~~~~~~~~~~~~~~~~~ ┄┄┼┄ 2 About page:    │
│ Sample Orthodontics    │                                             │   editor's query  │
│                        │ [Approve A] [Edit E] [Another hook 4]   [Do not contact]        │
└────────────────────────┴─────────────────────────────────────────────┴───────────────────┘
   the proof queue           highlighted claims; questioned ones           slips level
                             underlined in red pencil                      with each claim
```

**Signature element.** The margin.
- Every highlighted claim has a blue-pencil line to the quote it came from.
- Anything the editor questioned gets a red-pencil underline, with its query in the margin. The mock-up shows the sample draft about a "second office" that the About page says is only planned.

**Motion.**
- Approving writes a red-pencil "OK", with your initials and the time, in the margin. Then the next proof slides in.
- Leader lines draw when you focus a claim.
- With reduced motion, the mark simply appears.

**Why it's my pick.** It is the only direction where the look is the product's promise: you can see, line by line, that the email says only what the business says about itself.

**Honest risk.** It is the most familiar of the three. Serif-on-white editorial is a common AI look, so this direction lives or dies on the margin system and on restraint everywhere else.

## Checked against the list of AI tells

**What I caught and changed in my own first drafts:**
- **Criss-cross palette.** My first palette pulled Yellow Pages yellow. That is the one-step association ("directory means yellow"), and it was the option rejected in the earlier design research. It became the city directory's own two inks: black and edge red.
- **Criss-cross entries.** I first ruled a hairline under every entry, which is the broadsheet tell. Dot leaders replace them; rules stay only between columns.
- **Criss-cross fit score.** The open entry's score started as a big number with a small "strong fit" label under it: the stat-card tell in miniature. Now it is the directory line itself: `SAMPLE DENTAL STUDIO ····· 92`.
- **Line diagram highlight.** The challenger's "chosen line burning brightest" read as a glow. The open line is now drawn thicker instead, with no glow.
- **Line diagram colour.** Midnight with a single accent would be the near-black-plus-neon tell. It is committed to four line colours in a fixed order instead.
- **Galley palette.** My first instinct was cream proof paper with a serif and red: exactly the cream, serif and terracotta cluster. It became proof white, graphite, blue pencil and a highlighter, with red kept for questioned claims.
- **Galley sans.** My first pick was Instrument Sans, which is on the overused list. It is now Libre Franklin.
- **All three: meta strings.** Today's "1.2 mi · Email · Ready" middle-dot strings become each world's own grammar: directory sentences, station order, margin notes.
- **All three: arrows and icon tiles.** The ↗ arrows on links go. Icon-in-a-tile empty states become type.

**Deliberate exceptions, and why:**
- **Criss-cross keeps square corners and column rules.** A directory page *is* ruled columns. Its dot leaders and rounded die-cut tabs keep it from becoming generic broadsheet.
- **Line diagram keeps coloured circles.** Route bullets are how a transit line is named, not decoration.
- **Galley pairs one serif with one sans.** The serif is the thing being proofread, the email; the sans is the desk around it.

## Also dealt, not shown full size

- **Vertical video feed: held one test.** One draft fills the screen, actions are stacked on the right, and the next lead is one swipe away. Everyone knows it, but it hides the sources column the product is built on. It is worth borrowing for the phone layout only.
- **Star atlas, record sleeve, developer console, data field: declined.** Each lost on both tests. What each did better became a rule in Criss-cross (see above).
- **None of these?** I can deal a fresh set: same spread, safer or bolder. Or I can build the familiar category look properly, at full craft.
