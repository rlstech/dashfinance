---
name: DashFinance
description: Sala de controle financeira para operação, obras e administração da UAU.
colors:
  primary: "#D97706"
  primary-soft: "#FEF3C7"
  neutral-bg: "#EDF2F4"
  surface: "#FFFFFF"
  ink: "#1C2E38"
  sidebar: "#1C2E38"
  sidebar-muted: "#304650"
  line: "#D5E0E4"
  line-strong: "hsl(207 18% 68%)"
  positive: "#087F68"
  negative: "#B42318"
  info: "#256D8C"
typography:
  display:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "40px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.03em"
  title:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.08em"
rounded:
  sm: "8px"
  md: "10px"
  lg: "12px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "#FFFFFF"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
  input-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "40px"
  data-panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "24px"
---

# Design System: DashFinance

## Overview

**Creative North Star: "Sala de Controle Financeiro"**

DashFinance is designed as an operations room for financial decisions. The interface puts scope, freshness, state, and drill-down paths before decoration. It should feel dependable during a long reconciliation session, with enough density for expert users and enough hierarchy that an important variance is visible without hunting through equal-weight cards.

The visual world uses cool mineral surfaces, a graphite operations rail, and a restrained amber signal for actions and attention. Content remains light and readable; the dark shell carries navigation authority, not marketing drama. The system is a tool for operating, not a landing page.

**Key Characteristics:**
- Persistent operation rail with contextual filter dock.
- Quiet surfaces, hairline rules, and ambient depth.
- Tabular figures and explicit status labels for financial data.
- Signal amber reserved for actions, selection, and attention.
- Dense tables that remain usable on narrow screens through structural scrolling.

## Colors

The palette is restrained: graphite and mineral neutrals establish the workspace, while amber marks the next action. Positive, negative, and informational colors are paired with labels or icons and never carry meaning alone.

### Primary
- **Signal Amber**: the primary action and attention color. Use it for active controls, selected states, focus emphasis, and small status markers.

### Secondary
- **Operational Teal**: positive financial states, received values, and healthy confirmations.
- **Alert Red**: negative balances, overdue values, destructive actions, and errors.
- **Reference Blue**: informational states and the accumulated balance line in charts.

### Neutral
- **Cool Mineral**: the page background and filter-dock ground.
- **Surface White**: data panels, forms, tables, and content surfaces.
- **Graphite Ink**: primary text, primary actions, and the navigation rail.
- **Rail Slate**: secondary text and hover layers inside the navigation rail.
- **Data Line**: table rules, panel borders, and dividers.

### Named Rules
**The Signal Scarcity Rule.** Amber is a decision signal, not decoration. If every element is highlighted, nothing is active.

**The Meaning Is Not Color Alone Rule.** Financial status is always readable through text, position, icon, or number sign in addition to color.

## Typography

**Display Font:** IBM Plex Sans (with system sans fallback)
**Body Font:** IBM Plex Sans (with system sans fallback)
**Label/Mono Font:** IBM Plex Sans with tabular figures for measurements and currency.

**Character:** IBM Plex Sans gives the system a technical, measured voice without turning data into a costume. The same family handles navigation, prose, headings, and tables; scale and weight create hierarchy rather than a display-font split.

### Hierarchy
- **Display** (700, 40px, 1): primary financial total or dominant metric on an operation page.
- **Headline** (600, 24px, 1.2): page titles and high-level settings headings.
- **Title** (600, 18px, 1.3): panel titles and group names.
- **Body** (400, 14px, 1.45): descriptions, values, table content, and help text.
- **Label** (600, 11px, 1.2, tracked uppercase): scope labels, status labels, and metadata that should scan quickly.

### Named Rules
**The Table First Rule.** Use ordinary readable sentence case for explanatory copy; reserve tracked uppercase labels for metadata and navigation, never paragraphs.

## Layout

Desktop uses a 240px persistent navigation rail, a 72px sticky context header, and a flexible content canvas. Financial routes add a 280px contextual filter dock beside the canvas. Content uses 20px to 28px outer padding and a 20px grid gap, with wider panels allowed to carry tables and charts without artificial compression.

The navigation rail becomes a drawer below the desktop breakpoint. The filter dock remains independently discoverable through the context header and becomes a drawer on small screens. Tables keep their semantic structure and scroll horizontally when the data cannot safely collapse. Summary metrics stack vertically before the chart and table content.

## Elevation & Depth

Depth is ambient and tonal, not tactile or cartoon-like. Panels are separated by a hairline border and a very soft low-opacity shadow; the old hard offset shadow is not part of the new world. Dark navigation is a structural layer, while white data panels sit one level above the mineral page ground.

### Shadow Vocabulary
- **Panel ambient** (`0 10px 24px rgba(28, 46, 56, 0.06)`): default elevation for data panels and cards.
- **Dropdown ambient** (`0 16px 32px rgba(28, 46, 56, 0.14)`): menus, filter lists, and temporary overlays.

### Named Rules
**The Calm Surface Rule.** A panel should look settled at rest. Motion and elevation appear only when the user opens, focuses, hovers, or changes state.

## Shapes

The system uses gently rounded rectangles with 1px borders. Large panels use 12px corners, controls use 10px corners, and compact tags use 8px or pill shapes. Avoid sharp rectangular chrome except where a table or a deliberate data grid needs a straight edge. Do not use offset block shadows or thick border frames as default structure.

## Components

### Buttons
- **Shape:** compact rounded control with a 10px radius.
- **Primary:** graphite background, white text, 40px height, and 16px horizontal padding.
- **Hover / Focus:** signal amber hover state with visible keyboard focus ring; disabled controls keep their shape and reduce opacity.
- **Secondary / Ghost / Tertiary:** hairline outline or quiet text action, never a competing saturated block.

### Chips
- **Style:** compact rounded or pill label with a restrained fill and semantically paired text.
- **State:** active filters use a dark or amber-backed chip; removing a filter is an explicit `x` action with an accessible label.

### Cards / Containers
- **Corner Style:** 12px for panels, 10px for controls.
- **Background:** white content surfaces over the cool mineral background.
- **Shadow Strategy:** low ambient shadow only on panels that need separation.
- **Border:** 1px data line; no thick black frame.
- **Internal Padding:** 20px to 28px depending on density and viewport.

### Inputs / Fields
- **Style:** white background, 1px data line, 10px radius, readable 40px control height.
- **Focus:** amber border plus a low-opacity focus ring.
- **Error / Disabled:** red error surface with recovery copy; disabled fields retain their label and contrast while reducing interaction affordance.

### Navigation
- **Style:** graphite vertical rail with grouped labels, simple line icons, and a white active row. The context header carries the current route, active scope, sync status, and user actions. On mobile, navigation opens as a drawer while filters remain a separate drawer.

### Data Tables
- **Style:** semantic tables inside a white data panel, mineral header row, hairline separators, right-aligned tabular currency, and row hover only as a reading aid.
- **Behavior:** search, sorting, pagination, empty state, and footer totals share one vocabulary across Receitas, Despesas, and Fluxo de Caixa.

## Do's and Don'ts

### Do:
- **Do** keep the current financial rules, calculations, permissions, exports, and inline planning edits intact.
- **Do** show the active scope and data freshness near the route title.
- **Do** align currency values and use tabular figures for comparisons.
- **Do** pair status color with explicit Portuguese labels and accessible focus states.
- **Do** let density serve reconciliation rather than filling every area with equal cards.

### Don't:
- **Don't** turn the authenticated product into a marketing page or a decorative hero experience.
- **Don't** restore hard offset shadows, thick border frames, or uppercase text for every sentence.
- **Don't** use amber, green, or red as unexplained decoration.
- **Don't** hide filters, synchronization state, or permission constraints behind ambiguous icons.
- **Don't** change the meaning of previsto, realizado, entrada, saída, or saldo while changing their presentation.
