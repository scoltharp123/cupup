# CupUp

Plan coffee hangs with friends: start a crew, send the invite link, post hangs at Thump York, Thump Grove, or someone's place, and RSVP.

- `public/` — the app (plain HTML/CSS/JS, no build step)
- `netlify/functions/api.mts` — the API (accounts, crews, invites, hangs) on Netlify Blobs

Optional email sign-in: set `RESEND_API_KEY` (and `CUPUP_EMAIL_FROM`) in Netlify environment variables.
