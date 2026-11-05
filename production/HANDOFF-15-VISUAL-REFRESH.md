# HANDOFF-15 — Visual refresh ("Monday Native")

**Target commit:** `1b32db1` (v2.6.2 on `main`). Confirm you are on that commit before
starting. If `git status --short` shows changes to `styles.css`, `index.html` or
`app.js`, stop and say so.

**What this is:** a visual-only redesign of the existing renderer. Do **not** change
behaviour, the local-clock model, the IPC bridge, view switching, picker logic,
`addTimeSpent`, the write chain, or any safety net. Every non-negotiable rule in
`CLAUDE.md` still applies.

**Design source:** the "B · Monday Native" boards on the Claude Design canvas. Where
this document and the mockups disagree, **this document wins** — it was written against
the real files, the mockups were not.

## Rules for this handoff

- Every instruction is an **exact find-and-replace**. The repo uses real `<`, `>`,
  `&&`, `—`, `·`. Match literally, including the em dashes and middle dots.
- If a "find" block does **not** match, **STOP and tell David which one.** Do not
  improvise, do not fuzzy-match, do not "fix it up."
- Work **one Part at a time**. After each Part: run the harness checks listed at the
  end of that Part, tell David it's ready, and **wait**. Do not commit. Do not start
  the next Part until he says the current one passed.
- `SMOKE_TEST=1 ELECTRON_ENABLE_LOGGING=1 ./node_modules/.bin/electron . --no-sandbox`
  should still pass after every Part.
- Parts 1 through 6 are the redesign. Part 7 is optional and is clearly marked.

## What changes, in one paragraph

The app looks dated for four specific reasons: fully rounded capsule buttons, large
saturated red fills, cards floating on tinted gray with soft shadows, and three
competing button treatments on the running screen. Part 1 retunes the design tokens,
which does most of the work in one edit. Parts 2 through 6 fix the radii, flatten the
surfaces, and tighten the rows. Text also gets lighter: `--text-primary` moves from
`#323338` to `#404040`, which is David's stated maximum darkness for screen work.

---

# Part 1 — Design tokens

This is the single highest-value edit. It recolours every view in both themes at once.

### 1.1 Dark tokens

**Find** (the whole `:root` block, lines 8–35):

```css
:root {
  /* neutral graphite (dark) — cooler, lighter fills, no warm/gold cast */
  --bg-primary:      #24262B;
  --bg-secondary:    #30333A;   /* elevated card / selected fill */
  --bg-tertiary:     #2B2E34;   /* recessed / row rest */
  --border:          #3A3D44;
  --border-strong:   #474B53;
  --hairline:        #33363C;
  --text-primary:    #F5F6F8;
  --text-body:       #D6D8DE;
  --text-secondary:  #AEB1BA;
  --text-tertiary:   #8A8E98;
  --chip-bg:         rgba(233,84,104,.16);
  --chip-fg:         #F58399;
  --neutral-chip-bg: #3A3D44;
  --neutral-chip-fg: #B6B9C2;
  --ctrl-icon:       #969AA4;
  --accent-red:      #EA5468;   /* coral */
  --accent-green:    #00C875;
  --accent-blue:     #0073EA;
  --accent-yellow:   #FDAB3D;
  --idle-dot:        #565A63;
  --track:           #3A3D44;
  --track-fill:      #EA5468;
  --window-shadow:   0 22px 54px rgba(0,0,0,.5);
  --card-shadow:     0 3px 12px rgba(0,0,0,.28);
  --pill-shadow:     0 12px 30px rgba(0,0,0,.5);
}
```

**Replace with:**

```css
:root {
  /* HANDOFF-15 — neutral graphite, flattened: no card shadows, no coral */
  --bg-primary:      #202225;
  --bg-secondary:    #292C30;   /* elevated card / selected fill */
  --bg-tertiary:     #2B2E33;   /* recessed / row rest */
  --border:          #3A3E44;
  --border-strong:   #4A4F56;
  --hairline:        #2E3137;
  --text-primary:    #ECEDEF;
  --text-body:       #C8CBCF;
  --text-secondary:  #AFB4BA;
  --text-tertiary:   #9BA0A6;
  --chip-bg:         #31353B;
  --chip-fg:         #9BA0A6;
  --neutral-chip-bg: #31353B;
  --neutral-chip-fg: #9BA0A6;
  --ctrl-icon:       #868C93;
  --accent-red:      #C84A54;
  --accent-green:    #00C875;
  --accent-blue:     #579BFC;
  --accent-yellow:   #E8A317;
  --idle-dot:        #5A6068;
  --track:           #3A3E44;
  --track-fill:      #C84A54;
  --window-shadow:   0 10px 30px rgba(0,0,0,.45);
  --card-shadow:     none;
  --pill-shadow:     0 6px 18px rgba(0,0,0,.42);
}
```

### 1.2 Light tokens

**Find** (the whole light block, lines 37–65):

```css
/* warm cream paper (light) */
:root[data-theme="light"] {
  /* Monday-like neutral light — airy white + cool grays */
  --bg-primary:      #F6F7FB;
  --bg-secondary:    #FFFFFF;
  --bg-tertiary:     #EEF0F5;
  --border:          #E6E9EF;
  --border-strong:   #D0D4E4;
  --hairline:        #EDEFF4;
  --text-primary:    #323338;
  --text-body:       #4B4E57;
  --text-secondary:  #676879;
  --text-tertiary:   #9699A6;
  --chip-bg:         #FCE7EA;
  --chip-fg:         #D83A4E;
  --neutral-chip-bg: #EEF0F5;
  --neutral-chip-fg: #676879;
  --ctrl-icon:       #9699A6;
  --accent-red:      #E14B62;
  --accent-green:    #00C875;
  --accent-blue:     #0073EA;
  --accent-yellow:   #FDAB3D;
  --idle-dot:        #C3C6D4;
  --track:           #E6E9EF;
  --track-fill:      #E14B62;
  --window-shadow:   0 22px 54px rgba(60,45,30,.16);
  --card-shadow:     0 3px 10px rgba(60,45,30,.06);
  --pill-shadow:     0 12px 30px rgba(60,45,30,.2);
}
```

**Replace with:**

```css
/* HANDOFF-15 — flat white, no pink chips, 75% black ceiling on text */
:root[data-theme="light"] {
  --bg-primary:      #FFFFFF;
  --bg-secondary:    #F5F6FA;
  --bg-tertiary:     #F0F1F5;
  --border:          #E3E5EA;
  --border-strong:   #D9DCE2;
  --hairline:        #EDEFF3;
  --text-primary:    #404040;
  --text-body:       #53575D;
  --text-secondary:  #63686F;
  --text-tertiary:   #6E737A;
  --chip-bg:         #F1F2F4;
  --chip-fg:         #6E737A;
  --neutral-chip-bg: #F1F2F4;
  --neutral-chip-fg: #6E737A;
  --ctrl-icon:       #8A8F96;
  --accent-red:      #C84A52;
  --accent-green:    #00B86B;
  --accent-blue:     #2F6DB5;
  --accent-yellow:   #B5790F;
  --idle-dot:        #C8CBD0;
  --track:           #E3E5EA;
  --track-fill:      #C84A52;
  --window-shadow:   0 10px 30px rgba(32,34,37,.12);
  --card-shadow:     none;
  --pill-shadow:     0 6px 18px rgba(32,34,37,.10);
}
```

### Why `--text-tertiary` changed the most

In light it was `#9699A6`, which is about 2.9:1 against white. It is used for the
"RECENT" label, the `10h 59m today` sub-lines and the totals, so a lot of the app's
small text was failing readability. `#6E737A` is about 4.8:1 and passes.
`--accent-yellow` moved for the same reason: it is used as **text** on the stopped-job
badge, and `#FDAB3D` on white is unreadable.

### Part 1 test checklist

Serve `src/renderer` and open each of these. Check both light and dark.

1. `index.html?theme=light` — idle screen, nothing is pink, text is softer than before
2. `index.html?theme=dark` — idle screen, graphite not navy, no coral
3. `index.html?running=1&theme=light` — the card has lost its shadow
4. `index.html?running=1&theme=dark`
5. `index.html?view=picker&theme=light` — the `0m today` sub-lines are now readable
6. `index.html?view=picker&theme=dark`

Buttons are still capsule-shaped at this stage. That is expected. Part 2 fixes it.

**Stop here and wait for David.**

---

# Part 2 — Radii: the capsule fix

Nine edits, all in `styles.css`, all one line each. This is the single biggest
"it stopped looking dated" change.

**2.1** Find `  border-radius: 21px;\n  padding: 6px 12px;`
Replace `  border-radius: 8px;\n  padding: 6px 12px;`
(this is inside `.btn`)

**2.2** In `.btn-primary`, find `  border-radius: 23px;\n  font-size: 14px;`
replace `  border-radius: 5px;\n  font-size: 14px;`
(`23px` also appears on the pill. Including the `font-size` line is what makes this one
unambiguous. Do not shorten it.)

**2.3** In `.btn-stop`, find `  border-radius: 21px;\n  font-size: 13.5px;`
replace `  border-radius: 5px;\n  font-size: 13.5px;`

**2.4** In `.btn-switch`, find `  border-radius: 21px;\n  font-weight: 600;\n}`
replace `  border-radius: 5px;\n  font-weight: 600;\n}`

**2.5** In `.btn-distract`, find `  border-radius: 17px;\n  border: none;`
replace `  border-radius: 4px;\n  border: none;`

**2.6** In `.btn-log`, find `  border-radius: 17px;\n  background: var(--bg-secondary);`
replace `  border-radius: 4px;\n  background: var(--bg-secondary);`

**2.7** In `.filter-pill`, find `  padding: 6px 13px;\n  border-radius: 16px;`
replace `  padding: 6px 13px;\n  border-radius: 5px;`
(`16px` also appears on `.alert` and `.modal`. Keep the `padding` line in the match.)

**2.8** In `.search`, find `  border-radius: 20px;` replace `  border-radius: 5px;`

**2.9** In `textarea.search`, find `textarea.search {\n  height: auto;\n  border-radius: 14px;`
replace `textarea.search {\n  height: auto;\n  border-radius: 5px;`
(`14px` also appears on `.run-card`, `.toast` and `.mention-chip`. Keep the selector
line in the match.)

### The rest of the app's corners

Toasts, alerts, modals and the mention chips are not part of the three redesigned
screens, but they share the window. Left alone they would stay fully rounded while
everything around them went square, which looks like a half-finished job. Four more:

**2.10** In `.toast`, find `  border-radius: 14px;\n  padding: 12px 15px;`
replace `  border-radius: 5px;\n  padding: 12px 15px;`

**2.11** In `.alert`, find `  border-radius: 16px;\n  padding: 15px;`
replace `  border-radius: 5px;\n  padding: 15px;`

**2.12** In `.modal`, find `  border-radius: 16px;\n  padding: 16px;`
replace `  border-radius: 8px;\n  padding: 16px;`
(8px, not 5px. A modal is a surface, not a control.)

**2.13** In `.alert-actions .btn`, find `font-size: 12px; border-radius: 18px; }`
replace `font-size: 12px; border-radius: 5px; }`

**2.14** In `.mention-chip`, find `border: 1px solid var(--border); border-radius: 14px; padding: 5px 11px;`
replace `border: 1px solid var(--border); border-radius: 4px; padding: 5px 11px;`

### Part 2 test checklist

Same six URLs as Part 1, plus these, which reach the surfaces most people forget:

7. `index.html?alert=long&theme=light` — the alert box corners are tight
8. `index.html?morning=1&theme=light` — the morning modal, 8px corners
9. `index.html?welcome=1&theme=dark` — the welcome modal
10. `?running=1`, then click Comment to Monday — the mention chips are tight too

Every button, the search field and the filter pills should now have tight corners
instead of being fully rounded. The pill and the job rows are not done yet, that is
Parts 4 and 5.

**Stop here and wait for David.**

---

# Part 3 — Running view

### 3.1 Remove the decorative track from the markup

`app.js` writes to `#track-fill` and `#track-knob` but guards both with `if (tf)` and
`if (tk)`, so removing this markup is safe and needs no `app.js` change. Verify those
guards are present at `app.js` lines 200–202 before you proceed. If they are not,
**STOP**.

In `src/renderer/index.html`, **find**:

```html
          <div class="track">
            <div id="track-fill" class="track-fill"></div>
            <div id="track-knob" class="track-knob"></div>
          </div>
```

**Replace with** nothing (delete the four lines).

### 3.2 Flatten the run card

In `styles.css`, **find**:

```css
.run-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 15px 15px 16px;
  box-shadow: var(--card-shadow);
  margin-bottom: 11px;
}
```

**Replace with:**

```css
.run-card {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
  box-shadow: none;
  margin-bottom: 13px;
}
```

### 3.3 Job number becomes plain mono, not a chip

**Find:**

```css
.job-number {
  display: inline-flex;
  padding: 3px 8px;
  border-radius: 7px;
  background: var(--chip-bg);
  color: var(--chip-fg);
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: .3px;
  flex-shrink: 0;
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
}
```

**Replace with:**

```css
.job-number {
  display: inline-flex;
  padding: 0;
  border-radius: 0;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .2px;
  flex-shrink: 0;
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
}
```

### 3.4 Clock and totals

**Find:**

```css
.time-row { margin-top: 14px; }
.elapsed {
  font-size: 56px;
  font-weight: 500;
  font-family: 'JetBrains Mono', 'SF Mono', 'Cascadia Mono', Consolas, monospace;
  color: var(--text-primary);
  letter-spacing: .5px;
  line-height: .9;
}
```

**Replace with:**

```css
.time-row { margin-top: 11px; }
.elapsed {
  font-size: 48px;
  font-weight: 400;
  font-family: 'JetBrains Mono', 'SF Mono', 'Cascadia Mono', Consolas, monospace;
  color: var(--text-primary);
  letter-spacing: -1.8px;
  line-height: 1;
}
```

Then **find:**

```css
.totals {
  font-size: 11px;
  color: var(--text-tertiary);
}
```

**Replace with:**

```css
.totals {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 11px;
  min-height: 28px;
  line-height: 14px;
}
```

The `min-height` is deliberate. After Stop, this line carries the write-outcome text
from `WRITE_LABELS`, and the longest of those is "Not saved — no Time Spent column".
Reserving the height stops the buttons jumping when the message appears.

### 3.5 Equalise the bottom button row

The `−5m`, `−15m` and `Comment to Monday` buttons currently use three different
treatments. Make them one.

**Find:**

```css
.btn-log {
  flex: 1;
  height: 34px;
  border: 1.5px solid var(--accent-red);
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--accent-red);
  font-family: inherit;
  font-size: 12px;
  font-weight: 700;
```

**Replace with:**

```css
.btn-log {
  flex: 1.4;
  height: 28px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-tertiary);
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
```

The `white-space: nowrap` is load-bearing. Without it "Comment to Monday" wraps onto
two lines once the button stops being the widest thing in the row. I hit this in
testing. Do not drop it.

Then replace the **whole** `.btn-distract` rule. It ends with `flex: none;`, and that
line would override a `flex` set higher up in the same rule, so the trailing line is
the one that has to change. **Find:**

```css
.btn-distract {
  height: 34px;
  padding: 0 13px;
  border-radius: 4px;
  border: none;
  background: var(--bg-secondary);
  color: var(--text-tertiary);
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
  font-size: 11.5px;
  font-weight: 500;
  flex: none;
}
```

**Replace with:**

```css
.btn-distract {
  height: 28px;
  padding: 0 10px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
  font-size: 11.5px;
  font-weight: 500;
  flex: 1;
}
```

Then **find** `.btn-log:hover { background: var(--chip-bg); }`
**Replace with** `.btn-log:hover { background: var(--bg-secondary); color: var(--text-primary); }`

Then **find** `.btn-distract:hover { color: var(--text-secondary); }`
**Replace with** `.btn-distract:hover { background: var(--bg-secondary); color: var(--text-primary); }`

Note the `border-radius: 4px` in the two "find" blocks above. That value comes from
Part 2. If you see `17px` there, Part 2 did not apply and you should **STOP**.

### 3.6 Lighten the Stop button's shadow

**Find** (in `.btn-stop`):

```css
  font-weight: 700;
  box-shadow: 0 6px 16px rgba(40,45,70,.12);
}
.btn-stop:hover { filter: brightness(1.06); }
```

**Replace with:**

```css
  font-weight: 600;
  box-shadow: none;
}
.btn-stop:hover { filter: brightness(1.06); }
```

And in `.btn-primary`, **find:**

```css
  font-size: 14px;
  font-weight: 700;
  box-shadow: 0 6px 16px rgba(40,45,70,.12);
}
```

**Replace with:**

```css
  font-size: 13px;
  font-weight: 600;
  box-shadow: none;
}
```

### 3.7 Shrink the running window — REQUIRED, not optional

Removing the track and shortening the buttons makes the running view about **77px
shorter** than the window it lives in. Left alone, the redesign reintroduces exactly
the dead space the June pass was built to remove. I measured this in a browser at
340px wide: the content now ends at 247px inside a 324px window.

In `src/main.js`, **find:**

```js
const VIEW_SIZES = {
  idle:    { w: 340, h: 392 },
  running: { w: 340, h: 324 },
  picker:  { w: 340, h: 480 },
};
```

**Replace with:**

```js
const VIEW_SIZES = {
  idle:    { w: 340, h: 392 },
  running: { w: 340, h: 260 },
  picker:  { w: 340, h: 480 },
};
```

`idle` and `picker` are unchanged and measured correct. Do not touch them. This is the
only change to `main.js` in this handoff, and it is a value change inside the existing
`VIEW_SIZES` mechanism, so none of the `CLAUDE.md` window rules are in play.

### Part 3 test checklist

Parts 1 and 2 can be checked in the harness. **Part 3 needs real Electron** because of
3.7. Do both.

0. `npm start`, start a timer. The running window should size itself snugly, with no
   empty band under the −5m row. Switch to the picker and back; the window should
   resize both ways cleanly.
0b. Click `−5m`. The red flash feedback is absolutely positioned at `top: 118px`, which
   used to sit under a taller clock. Confirm it still lands sensibly and does not
   overlap the buttons. If it looks wrong, tell David the number rather than changing it.

1. `index.html?running=1&theme=light` — no progress bar, no card outline, clock is
   48px, and the three bottom buttons are **equal width**. If `−5m` and `−15m` are
   narrow and `Comment to Monday` is wide, the `flex: none` fix in 3.5 did not apply.
2. `index.html?running=1&theme=dark` — same
3. Start a timer in the harness and let it run past a minute. The clock should tick
   without the layout shifting.
4. Stop the timer. The line under the clock should show a write-outcome message and
   the buttons below it should **not** move.
5. `?running=1` then click `−5m`. The flash feedback should still work.

**Stop here and wait for David.**

---

# Part 4 — Picker rows and sections

The rows are built in `app.js` and keep their hover play pill, their Log Time button
and their stopped badge. This Part only restyles them.

### 4.1 Rows become list rows, not cards

**Find:**

```css
.job-row {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 10px 11px;
  border-radius: 13px;
  cursor: pointer;
  transition: background 0.12s;
}
.job-row:hover { background: var(--bg-tertiary); }
```

**Replace with:**

```css
.job-row {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 7px 9px;
  border-radius: 5px;
  border-bottom: 1px solid var(--hairline);
  cursor: pointer;
  transition: background 0.12s;
}
.job-row:hover { background: var(--bg-secondary); }
```

### 4.2 Tighten the list spacing so more rows fit

**Find:**

```css
.picker-list {
  height: calc(100% - 90px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding-right: 2px;
}
```

**Replace with:**

```css
.picker-list {
  height: calc(100% - 90px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0;
  padding-right: 2px;
}
```

### 4.3 Flatten the active and stopped rows

**Find:**

```css
.job-row.active { background: var(--bg-secondary); box-shadow: var(--card-shadow); }
.job-row.active .job-row-name { font-weight: 700; }
.job-row.active .job-row-num { color: var(--chip-fg); }
```

**Replace with:**

```css
.job-row.active { background: var(--bg-secondary); box-shadow: none; }
.job-row.active .job-row-name { font-weight: 600; }
.job-row.active .job-row-num { color: var(--text-secondary); }
```

Then **find** `.job-row.stopped { background: var(--bg-secondary); box-shadow: var(--card-shadow); }`
**Replace with** `.job-row.stopped { background: var(--bg-secondary); box-shadow: none; }`

### 4.4 Row text hierarchy

**Find:**

```css
.job-row-num { font-weight: 700; font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace; color: var(--neutral-chip-fg); }
```

**Replace with:**

```css
.job-row-num { font-size: 11px; font-weight: 600; font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace; color: var(--text-tertiary); }
```

### 4.5 The two hover buttons

**Find:**

```css
.job-row-play-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 15px;
```

**Replace with:**

```css
.job-row-play-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 4px;
```

Then **find:**

```css
  width: 30px;
  height: 30px;
  border-radius: 15px;
  flex-shrink: 0;
  background: none;
  border: 1px solid var(--border-strong);
```

**Replace with:**

```css
  width: 28px;
  height: 28px;
  border-radius: 4px;
  flex-shrink: 0;
  background: none;
  border: 1px solid var(--border-strong);
```

(this one is inside `.job-row-export`)

Then **find** `.job-row-export:hover { border-color: var(--accent-red); color: var(--accent-red); background: var(--chip-bg); }`
**Replace with** `.job-row-export:hover { border-color: var(--accent-red); color: var(--accent-red); background: transparent; }`

### 4.6 Section labels

`RECENT` and `ALL ASSIGNED` stay. Just calm them down.

**Find:**

```css
.section-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--text-tertiary);
  margin: 8px 4px 2px;
}
```

**Replace with:**

```css
.section-label {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--text-tertiary);
  margin: 12px 4px 4px;
}
```

### 4.7 Search field

**Find:**

```css
.search {
  width: 100%;
  height: 40px;
```

**Replace with:**

```css
.search {
  width: 100%;
  height: 34px;
```

Then **find** `.search:focus { border-color: var(--accent-red); }`
**Replace with** `.search:focus { border-color: var(--border-strong); }`

### 4.8 Filter pills

**Find:**

```css
.filter-pill {
  flex-shrink: 0;
  background: var(--bg-secondary);
  border: none;
  color: var(--text-secondary);
  font-size: 11.5px;
  font-weight: 600;
  font-family: inherit;
  padding: 6px 13px;
```

**Replace with:**

```css
.filter-pill {
  flex-shrink: 0;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  font-family: inherit;
  padding: 5px 11px;
```

Leave `.filter-pill.active { color: #fff; }` alone. `renderFilterPills()` sets the
active pill's background inline from the Monday group colour, and that behaviour stays.

### Part 4 test checklist

1. `index.html?view=picker&theme=light` — rows are separated by hairlines rather than
   floating as cards, and more of them fit on screen
2. `index.html?view=picker&theme=dark` — same
3. Hover a row. The play pill and the Log Time button should still appear, now with
   square-ish corners.
4. Type in the search box. Results should still filter and the focus ring should be a
   neutral grey rather than red.
5. Click a group filter pill. The active pill must still take the Monday group colour.
6. Check that `RECENT` and `ALL ASSIGNED` headings are both still present.

**Stop here and wait for David.**

---

# Part 5 — The pill

The pill has its own local variable block, so this is mostly two edits. It has three
states (running, stopped, idle) and all three must keep working.

### 5.1 Dark pill variables and shape

**Find:**

```css
.pill {
  --p-fg:#F5F6F8; --p-dim:#9A9DA6;
  --p-bar:#24262B; --p-bar-bd:#3A3D44;
  --p-btn-bg:#30333A; --p-btn-bd:#474B53; --p-btn-fg:#CDD0D6; --p-btn-hover:#3A3E45;
  --p-chip-bg:rgba(233,84,104,.18); --p-chip-fg:#F58399;
  --p-cmt-bg:rgba(233,84,104,.22); --p-cmt-fg:#F7A6B5;
  --p-grab:#8A8E98; --p-red:#EA5468;
  height: 48px;
  width: max-content;
  display: inline-flex; align-items: center; gap: 7px;
  background: var(--p-bar); border: 1px solid var(--p-bar-bd);
  border-radius: 23px; box-shadow: 0 12px 30px rgba(0,0,0,.55);
  padding: 7px 8px; overflow: hidden; white-space: nowrap;
}
```

**Replace with:**

```css
.pill {
  --p-fg:#ECEDEF; --p-dim:#9BA0A6;
  --p-bar:#26282C; --p-bar-bd:#3E4248;
  --p-btn-bg:transparent; --p-btn-bd:transparent; --p-btn-fg:#9BA0A6; --p-btn-hover:#31353B;
  --p-chip-bg:transparent; --p-chip-fg:#9BA0A6;
  --p-cmt-bg:transparent; --p-cmt-fg:#868C93;
  --p-grab:#5F656D; --p-red:#C84A54;
  height: 48px;
  width: max-content;
  display: inline-flex; align-items: center; gap: 8px;
  background: var(--p-bar); border: 1px solid var(--p-bar-bd);
  border-radius: 8px; box-shadow: 0 6px 18px rgba(0,0,0,.42);
  padding: 7px 8px; overflow: hidden; white-space: nowrap;
}
```

### 5.2 Light pill variables

**Find:**

```css
:root[data-theme="light"] .pill {
  --p-fg:#323338; --p-dim:#9699A6;
  --p-bar:#FFFFFF; --p-bar-bd:#E6E9EF;
  --p-btn-bg:#EEF0F5; --p-btn-bd:#D0D4E4; --p-btn-fg:#4B4E57; --p-btn-hover:#E3E6EE;
  --p-chip-bg:#FCE7EA; --p-chip-fg:#D83A4E;
  --p-cmt-bg:#FBDCE0; --p-cmt-fg:#D83A4E;
  --p-grab:#9699A6; --p-red:#E14B62;
  box-shadow: 0 12px 30px rgba(60,45,30,.22);
}
```

**Replace with:**

```css
:root[data-theme="light"] .pill {
  --p-fg:#404040; --p-dim:#6E737A;
  --p-bar:#FFFFFF; --p-bar-bd:#DDE0E6;
  --p-btn-bg:transparent; --p-btn-bd:transparent; --p-btn-fg:#6E737A; --p-btn-hover:#F0F1F5;
  --p-chip-bg:transparent; --p-chip-fg:#6E737A;
  --p-cmt-bg:transparent; --p-cmt-fg:#8A8F96;
  --p-grab:#B9BEC6; --p-red:#C84A52;
  box-shadow: 0 6px 18px rgba(32,34,37,.10);
}
```

### 5.3 Pill button radii

**5.3a** In `.pill-number`, find `padding:2px 6px; border-radius:6px;`
replace `padding:0; border-radius:0;`

**5.3b** In `.pill-mbtn`, find `  height:28px; padding:0 8px; border-radius:14px;`
replace `  height:24px; padding:0 7px; border-radius:4px;`

**5.3c** In `.pill-ibtn`, find `  width:28px; height:28px; border-radius:14px;\n  border:1px solid var(--p-btn-bd); background:var(--p-btn-bg); color:var(--p-btn-fg);\n  display:inline-flex; align-items:center; justify-content:center; cursor:pointer; padding:0;`
replace `  width:26px; height:26px; border-radius:4px;\n  border:1px solid var(--p-btn-bd); background:var(--p-btn-bg); color:var(--p-btn-fg);\n  display:inline-flex; align-items:center; justify-content:center; cursor:pointer; padding:0;`

**5.3d** In `.pill-cbtn`, find `  width:28px; height:28px; border-radius:14px;\n  border:none; background:var(--p-cmt-bg); color:var(--p-cmt-fg);`
replace `  width:26px; height:26px; border-radius:4px;\n  border:none; background:var(--p-cmt-bg); color:var(--p-cmt-fg);`

**5.3e** In `.pill-stop`, find `  width:30px; height:30px; border-radius:15px; border:none;\n  background:var(--p-red); color:#fff;`
replace `  width:26px; height:26px; border-radius:4px; border:none;\n  background:var(--p-red); color:#fff;`

Then find `  box-shadow:0 3px 9px rgba(40,45,70,.18); -webkit-app-region:no-drag;`
replace `  box-shadow:none; -webkit-app-region:no-drag;`

**5.3f** In `.pill-start`, find `  height:30px; padding:0 14px; border-radius:15px; border:none;\n  background:var(--p-red); color:#fff; font-family:inherit; font-size:12.5px; font-weight:700;`
replace `  height:28px; padding:0 13px; border-radius:4px; border:none;\n  background:var(--p-red); color:#fff; font-family:inherit; font-size:12px; font-weight:600;`

### Part 5 test checklist

The pill's width is measured at runtime by a `ResizeObserver` and sent to the main
process. These edits change button sizes, so the width changes. **This is the part most
likely to break, test it in real Electron, not just the harness.**

1. `npm start`, start a timer, click minimize. The pill should appear with square-ish
   corners and no gap at either end.
2. Let the clock cross from `9:59` to `10:00`. The pill must resize to fit and keep its
   right edge pinned.
3. Drag the pill by the grabber dots. It should move and not oscillate.
4. Click the info area. It should expand to the running view.
5. Stop the timer from the pill. The pill should switch to the Resume / Switch / Expand
   state and still fit.
6. With no timer and no recent job, the pill should show the "Select a job" state.
7. Try to resize the pill from its edges. It should be inert.

If the pill is clipped or has dead space at the right, that is the `ResizeObserver`
measuring before the font loads. Tell David rather than changing `app.js`.

**Stop here and wait for David.**

---

# Part 6 — Settings window

`src/settings-window/settings.css` has its own copy of the colour values. Open it and
report back to David what its `:root` and `:root[data-theme="light"]` blocks currently
contain **before changing anything** — I wrote this handoff against `src/renderer/`
and did not read the settings stylesheet in full, so I am not going to hand you
find-and-replace blocks I cannot guarantee.

Once David has seen them, apply the same token values from Part 1 that exist in that
file, and the same radius rule: any `border-radius` of 14px or more on a button, input
or select becomes `5px`; any pill-shaped small control becomes `4px`.

Do not change any input IDs, the hotkey recorder, the column picker, or the
save/cancel behaviour.

### Part 6 test checklist

1. Open Settings from the gear icon in both themes.
2. The token field, board ID, column picker and both hotkey recorders still work.
3. Save and start still saves.
4. The detected-column status line under the Time Spent picker still appears.

**Stop here and wait for David.**

---

# Part 7 — OPTIONAL: Today / Total as a stat block

Only do this if David asks for it. Everything above stands on its own without it.

This replaces the single `Today 1h 12m · Total 4h 05m` line with two labelled cells on
a tinted panel. It needs an `index.html` change **and** an `app.js` change, which is
why it is separated out and last.

### 7.1 Markup

In `index.html`, **find:**

```html
          <div class="totals">
            <span id="today">Today 0m</span><span class="totals-sep"> · </span><span id="total">Total 0m</span>
          </div>
```

**Replace with:**

```html
          <div class="totals" id="totals-line"></div>
          <div class="stat-strip">
            <div class="stat-cell"><span class="stat-key">TODAY</span><span id="today" class="stat-val">0m</span></div>
            <span class="stat-div"></span>
            <div class="stat-cell"><span class="stat-key">TOTAL</span><span id="total" class="stat-val">0m</span></div>
          </div>
```

### 7.2 Styles

Add to the end of `styles.css`:

```css
/* HANDOFF-15 Part 7 — Today / Total stat strip */
.stat-strip {
  display: flex;
  background: var(--bg-secondary);
  border-radius: 5px;
  margin-top: 4px;
}
.stat-cell { flex: 1; padding: 7px 11px; }
.stat-key {
  display: block;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .7px;
  color: var(--text-tertiary);
}
.stat-val {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-top: 2px;
}
.stat-div { width: 1px; background: var(--border); margin: 7px 0; }
```

### 7.3 Script

In `app.js`, **find:**

```js
    $('today').innerHTML = 'Today <strong>' + fmtToday(today) + '</strong>';
    $('total').innerHTML = 'Total <strong>' + fmtToday(total) + '</strong>';
```

**Replace with:**

```js
    $('today').textContent = fmtToday(today);
    $('total').textContent = fmtToday(total);
```

Note that `#totals-line` is now empty and is what the write-outcome text should land
in. Search `app.js` for where `writeLabel(` is rendered and confirm it targets an
element that still exists. **If it targeted `#today` or `#total`, STOP and tell David**,
because this Part would break the post-stop message and that message is the whole point
of v2.6.1.

### Part 7 test checklist

1. `?running=1` — Today and Total appear as two labelled cells
2. Let it run a minute, both values update
3. Stop — the write-outcome message appears above the stat strip and the strip still
   shows the right numbers
4. `?running=1&theme=dark` — the strip panel is visible but not loud

---

# When everything passes

Commit as:

```
v2.7.0 — HANDOFF-15 visual refresh: flat surfaces, tight radii, denser picker
```

Push to `main` and confirm the push landed. Then update `CLAUDE.md`: set the version to
v2.7.0, note HANDOFF-15 applied, change "Next handoff number" to HANDOFF-16, and update
the Theme bullet to describe the flattened look. Add a `v2.7.0` section to
`CHANGELOG.md`.

Finally, save this document as `production/HANDOFF-15-VISUAL-REFRESH.md` so the record
does not go missing the way 12 through 14 did.
