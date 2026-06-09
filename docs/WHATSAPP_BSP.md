# WhatsApp Business API — Setup Checklist (B2B)

MoveOS notifies the **business client** (the store/distributor that originated
the shipment) — never the end consumer. WhatsApp is one of four channels a
business can choose (`WEBHOOK` / `WHATSAPP` / `EMAIL` / `IN_APP`); this doc
covers turning the WhatsApp one on. The code is ready — only credentials and
template approval are missing.

## What you're setting up (the chain)

```
MoveOS API → BSP / Meta Cloud API → WhatsApp Business Platform → ops contact of the business client
```

- **WABA** (WhatsApp Business Account): your company's identity at Meta. Owns
  the phone number and templates.
- **BSP** (Business Solution Provider): authorized access provider. For your
  volume, **Meta Cloud API direct** (free per-platform, pay per conversation)
  or **360dialog / Twilio** are the pragmatic options in LatAm.

## Checklist (start now — approval takes days to weeks)

1. **Meta Business Manager** verified for MOVE Electromobility Solutions
   (NIT, certificado de existencia, utility bill). This is the long pole.
2. Pick the access route:
   - *Meta Cloud API direct* (recommended to start): create an app at
     developers.facebook.com → WhatsApp product → get a permanent token +
     phone number ID. No middleman fees.
   - *BSP (360dialog/Twilio)*: simpler dashboard, support, template tooling.
3. **Dedicated phone number** (cannot be one already on the WhatsApp app).
4. **Submit message templates** for approval (below) — category *UTILITY*
   (delivery notifications), language `es_CO`.
5. Put credentials in the API host env:
   `WHATSAPP_BUSINESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`.
6. Set each business client's `notifyChannel = WHATSAPP` + their ops phone in
   the **Clientes** page.

## Templates to submit (B2B — match `services/notifications.ts`)

| Template name | Suggested body (es_CO) |
|---|---|
| `envio_en_reparto` | "📦 {{1}}: tu envío guía {{2}} para {{3}} salió a reparto con el conductor {{4}}." |
| `envio_entregado` | "✅ {{1}}: tu envío guía {{2}} fue entregado a {{3}} ({{4}}). Evidencia disponible en tu panel." |
| `envio_fallido` | "⚠️ {{1}}: no se pudo entregar el envío guía {{2}} para {{3}}. Motivo: {{4}}. Se reprogramará." |

> Note: the current adapter sends the template without variable substitution
> (skeleton). When credentials exist, extend `WhatsAppAdapter.send` to map
> `payload` → `components[].parameters` — a ~15-line change flagged in code.

## Costs (orientation, Colombia)

Meta charges per 24-hour conversation window. Utility conversations in
Colombia run on the order of **US$0.01–0.03 per delivery notification
thread** — negligible per shipment, worth tracking at scale.

## Why this is the long-lead item

Business verification + template review are Meta-human-review processes
(days to weeks) that no code can accelerate. Everything else in this repo is
ready the moment the two env vars exist.
