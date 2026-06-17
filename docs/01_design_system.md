# MoveOS — Design System & UI/UX Upgrade Spec

Make the product look like Move, not a generic dashboard. This codifies the Move brand (from Manual de Identidad v2.0) into a digital design system, and adopts the clean UI patterns from Spoke Dispatch — skinned in Move's palette, never Spoke's blue. For Claude Code. Spanish UI, America/Bogotá. Apply across apps/web, apps/admin, apps/driver.

## 1. Brand foundation (from Manual de Identidad v2.0)

Color palette (the only brand colors):
- Azul Marino (navy) #233955 — RGB 35/57/85 — PRIMARY: headers, sidebars, primary text, primary buttons.
- Blanco #F3F3F3 — RGB 243/243/243 — PAGE BACKGROUND (canvas).
- Verde Limón (lime) #CFDD80 — RGB 207/221/128 — ACCENT: reserve for EV/charging/sustainability + key highlights/CTAs.
- Azul Cielo (sky) #A7B6C4 — RGB 167/182/196 — SECONDARY: muted text on navy, secondary/info, borders.
(Print refs: Pantone 534C/373C/537C + CMYK — not needed for UI.)

Typography:
- Primary: Aileron (geometric sans). Weights: Light, Regular, Medium. Aileron is free — self-host. Headings/UI.
- Secondary: Soliden (versatile sans) — supporting/body. Commercial — license or fall back.
- Web fallback stack: 'Aileron','Inter',system-ui,sans-serif. Use two weights in product (400, 500); reserve Light for large display headings.
- The logo wordmark is italic/right-slanted — do NOT recreate the logo in CSS; use the supplied asset.

Voice & tone (all UI microcopy):
- Tono: Claro · Cercano · Profesional. Spanish, no unnecessary jargon.
- Brand keywords: Eficiencia, Sustentabilidad, Innovación, Compromiso, Conexión.
- Tagline: "Última milla con máxima eficiencia."
- Use brand phrases in empty states / onboarding: "Potencia tu flota, reduce tus costos." · "El motor limpio de tu negocio." · "Entregas rápidas, operaciones inteligentes."

## 2. Digital design tokens

Brand has no functional red/amber — add accessible, muted semantic colors for states.

  :root {
    --navy:#233955; --navy-700:#1b2c43; --navy-900:#152334;
    --canvas:#F3F3F3; --surface:#FFFFFF;
    --lime:#CFDD80; --lime-ink:#4b5320;   /* text on lime = navy or lime-ink */
    --sky:#A7B6C4; --sky-50:#eef2f5;
    --text-primary:#233955; --text-secondary:#5b6b7d; --text-tertiary:#8a99a8;
    --border:#e6e6e4; --border-strong:#d6dade;
    --success:#5a6b18; --success-bg:#eef1e3;
    --info:#3a5169; --info-bg:#eef2f5;
    --warning:#8a5a12; --warning-bg:#f7efe0;
    --danger:#a32d2d; --danger-bg:#fdecec;
    --radius-md:8px; --radius-lg:12px; --radius-xl:16px;
    --shadow-soft:0 1px 2px rgba(35,57,85,.06),0 4px 16px rgba(35,57,85,.06);
  }

Contrast rules: lime is light — never put lime text on white. Lime is for fills/accents (charge bars, EV/CO₂ figures, success badges, a CTA) with NAVY text on lime. Navy is the workhorse for text/headers/primary buttons. Sky is muted accents/borders only.

Lime = the EV/sustainability signal: use it for SoC/charging, the green/CO₂ report, and on-time/success. Reinforces "el motor limpio." Don't scatter it.

Type scale: Display 24/Light–Regular (big numbers); H1 22/500; H2 18/500; H3 16/500; Body 14–16/400 lh 1.6; Caption 12–13/400.

Tailwind theme.extend:
  colors: { navy:{DEFAULT:'#233955',700:'#1b2c43',900:'#152334'}, canvas:'#F3F3F3', surface:'#FFFFFF', lime:{DEFAULT:'#CFDD80',ink:'#4b5320'}, sky:{DEFAULT:'#A7B6C4',50:'#eef2f5'} },
  fontFamily:{ sans:['Aileron','Inter','system-ui','sans-serif'] },
  borderRadius:{ md:'8px', lg:'12px', xl:'16px' },
  boxShadow:{ soft:'0 1px 2px rgba(35,57,85,.06),0 4px 16px rgba(35,57,85,.06)' },

## 3. Component system (Spoke's patterns, Move-skinned)

- App shell: collapsible left sidebar in NAVY with the Move wordmark; nav items in sky, active item in LIME; top header with breadcrumbs, plan banner, help, notifications, profile menu. Canvas bg, white cards.
- Buttons: primary = navy fill/white text; highlight/CTA = lime fill/navy text (sparingly); secondary = outlined navy ghost. Radius md.
- Inputs: outlined, navy focus ring.
- Pill toggles: navy on, gray off.
- Modals & drawers: centered modals + right-side drawers for create flows; white, soft shadow, soft radius; two-column drawer (calendar/form) like Spoke's Create new route.
- KPI metric cards: muted 12–13px label + 23px/500 number; one card navy-filled with a LIME number for the hero/EV metric. Grids of 2–4.
- Data tables: sticky header, search + filter + export, status badges, row hover, pagination (Drivers, Pedidos, Invoices).
- Status badges: soft bg + same-family dark text (success=lime, info=sky, warning, danger).
- Empty states: centered icon/illustration + title + one CTA + a brand phrase (warm, Cercano tone).
- Controls hub: grid of setting cards (Depósitos, Servicios, Prueba de entrega, Zonas, Permisos de conductor, Seguimiento…) like Spoke's Controls overview.
- Charts: line + donut in navy/sky with lime for the positive series; legible, minimal.
- Onboarding: depot-setup modal → welcome pathways → setup checklist with checkmarks → connect driver app via QR + store badges.

## 4. Per-app polish

- apps/web (dispatcher): shell + tokens; Today's overview header, KPI card row, Controls hub grid, branded empty states, consistent tables; the Exceptions Cockpit becomes the styled home.
- apps/admin (platform): same system; data-dense but calm. Navy headers, sky dividers, lime only for health-positive signals.
- apps/driver (PWA): brand-skinned, NAVY as the dark/night base, lime for SoC/charge and success confirmations, big tap targets, one-handed layout.

## 5. Implementation notes for Claude Code

1. Fonts: self-host Aileron (free) via @font-face (Light/Regular/Medium); license Soliden or fall back to Inter; set the Tailwind sans stack. Not on Google Fonts.
2. Tokens first: add CSS variables + Tailwind theme, then replace ad-hoc colors across the three apps with tokens. No hardcoded hex in components.
3. Dark mode: build on navy (navy-900 base, lighter navy surfaces, near-white text, lime/sky accents). Driver app ships dark-first.
4. Accessibility: navy-on-canvas and white-on-navy pass; lime is decorative/fill only, always pair with navy text. Min font 12px.
5. Microcopy pass: sweep UI strings to Claro/Cercano/Profesional; use brand phrases in empty states + onboarding.
6. Keep the logo as an asset — don't recreate the wordmark in CSS.

Net: Spoke gives the layout discipline; the Manual de Identidad gives the soul. Navy + lime + sky on a light canvas, Aileron type, warm-professional Spanish copy, and lime reserved for the EV/sustainability story — that's what makes MoveOS look like Move, and better than Spoke.
