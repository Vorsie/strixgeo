# Activation architecture — decision memo

**For:** owner. **Date:** 2026-08-27. **Decision needed:** which activation
architecture debt #3 builds, before the first paid checkout opens.
**Status:** the *architecture* below is still an owner decision; the beta-expiry
primitive (`docs/design/beta-expiry.md`) shipped, and the desktop *client half*
of Option C has since landed as a reviewable prototype — the state machine, the
`ActivationRepository` seam + mock issuer, the HTTP client + written contract
(`activation-api-contract.md`), and the **self-service deactivate/transfer flow**
(ruling 15) with its irreversible-action confirmation dialog. Still MOCKED/open:
the strixgeo.com server, Stripe, and the Ed25519 signature (§8). See
`docs/design/onboarding-activation-updater-proto.md`.

---

## The question

The model is an **annual subscription** (Solo €89/mo, Pro €159/mo, Studio
€129/seat·mo, billed annually, 30-day trial). The product is a **desktop app
that must work offline on site**. Those two facts pull in opposite directions:
a subscription needs a recurring check, and an on-site engineer has no network.

Three architectures resolve that. They differ mainly in **how long a cancelled
customer keeps working** and **whether you ever learn how many seats a firm
actually runs**.

---

## Option A — offline signed licence file only

Ed25519 keypair. A licence file carries `licence_id`, email, tier, `expires_at`;
the app verifies it against a public key embedded in the binary. Issued by hand
(or by a Stripe webhook writing a file) and emailed to the customer.

* **Defends:** running with no licence at all; using an expired one; a build past
  its date (tonight's expiry logic, unchanged).
* **Does not defend:** copying one licence file to ten machines. Machine-binding
  requires collecting a fingerprint *before* issuing, i.e. an email round-trip
  per seat. Cancellation cannot be enforced — a cancelled annual customer keeps
  working until the file expires, up to a year.
* **Cost:** €0/month. **Effort:** 3–4 days.
* **Breaks at:** ~20 customers, where manual renewal emails become the job.

## Option B — online activation server

The app activates against our endpoint, which checks Stripe subscription state
and returns a token; it re-checks on a schedule. No signed file.

* **Defends:** everything in A, plus seat counting, revocation on
  cancellation/refund/chargeback, and per-machine limits.
* **Cost:** €5–25/month hosting + a domain, **plus an availability obligation** —
  if the server is down, customers cannot start work. That obligation is the
  real price, not the €25.
* **Effort:** 1.5–2 weeks (Stripe webhook, activation + refresh endpoints, admin
  view, revocation, desktop UI).
* **Weakness:** a naive implementation fails closed on every network hiccup,
  which is exactly the on-site scenario we sell against.

## Option C — hybrid: server issues, signed file authorises *(recommended)*

The server is the **issuer**; a short-lived signed licence file is the
**authority the app checks offline**.

* First run: the customer enters a key (or signs in) → the server binds it to a
  machine fingerprint, checks Stripe, and returns a signed licence valid for a
  **30-day grace window**, carrying the subscription period end and the tier.
* The app silently refreshes in the background whenever it has a network. Each
  refresh re-checks Stripe.
* **Offline is a non-event**: the app runs on the signed file until the grace
  window ends. A month on site never touches the network.
* **Cancellation, refunds, chargebacks:** stop re-issuing. Worst-case abuse
  window is the grace window (30 days), not a year.
* **Clock tampering** — extending the grace window by winding the clock back —
  is already handled by tonight's monotonic anchor (`betaExpiryStore.ts`); it
  applies unchanged.
* **Cost:** same as B. **Effort:** B + ~2 days for the file format and verifier,
  most of whose shape exists after tonight.

---

## Tier encoding — how the app tells Solo from Pro from Studio

*(Owner note, recorded 2026-09-01 from the onboarding-prototype review, cleaned
up. NOT built — there is no server yet; this is a design option for stage 2.)*

The app has to know which tier a key grants (it gates exports on the tier). Two
shapes, both compatible with Option C's signed file:

* **Tier lives in the DB, carried in the signed licence (recommended).** The key
  itself is an opaque random string; the server looks it up, finds the tier, and
  writes the tier INTO the signed licence file it issues. The app reads the tier
  from the signed (tamper-proof) file, never from the key. Clean separation: the
  key is just an identifier, the DB row is the source of truth, and re-tiering a
  customer is a one-row change. No tier information leaks in the key string.
* **Salt/encode the tier into the key.** The key is minted so its own bytes
  reveal the tier (a prefix, or a salted encoding). Lets the app guess the tier
  before any server round-trip. Trade-off: the tier is now visible in the key,
  re-tiering means re-issuing the key, and it is only a hint — the signed file
  still has to be the authority, so it buys little.

**Recommendation:** tier in the DB, carried in the signed licence. The key stays
an opaque token; the signed file is the single tamper-proof authority for tier,
dates and device binding. The **key format itself is deliberately left open** —
it is a downstream choice of the Ed25519 signing decision (Option C, stage 2).

---

## The file-passing leak — no change of position

`.strix` is portable and offline, so any *occasional gated action* (export) can
be centralised on one Pro seat. **Recommendation: keep accepting it.** DRM on
project files would poison the offline / own-your-data differentiator that is
the whole argument against SoilCloud. Concretely:

* Per-seat revenue lives in **Solo**; Pro is "the firm's export station".
* Option C is what makes the leak *measurable* — the server sees how many
  machines a licence runs on, so a firm quietly running 12 seats on one Solo
  licence becomes a sales conversation rather than an invisible loss.
* Keep the soft deterrent already decided: stamp exports "Generated by StrixGeo
  Pro — licensed to \<firm\>" in the DXF header / PDF footer / Plaxis comment.
* Gate exports on the **tier claim inside the signed licence**, not on a local
  setting.

---

## Recommendation

**Build Option C, in two stages.**

| Stage | When | What | Effort | Running cost |
|---|---|---|---|---|
| 1 — done | now | Beta expiry: build-stamped date, monotonic clock anchor, hard stop, renewal dialog | shipped | €0 |
| 2 | before the first paid checkout | Stripe webhook → licence issuing → machine binding → signed 30-day licence + background refresh + "Enter licence" UI | ~2 weeks | €5–25/mo |
| 3 | after ~20 customers | Seat management (self-service deactivate, Studio seat pool), admin console | ~1 week | unchanged |

**Why C over A:** the exposure that actually costs money is a cancelled
subscription that keeps working for a year. A caps that at the licence term; C
caps it at 30 days for the same infrastructure B needs anyway.

**Why C over B:** B without a signed offline artefact makes our own uptime a
precondition for a customer's field work. C degrades to "works fine for 30 days"
instead of "cannot start".

**Prerequisite, not optional:** installer code-signing (#6). An unsigned binary
that SmartScreen already warns about gives a tampered copy nothing to stand out
against.

**Explicitly not recommended** (consistent with debt #5): anti-debug, code
obfuscation, hardware dongles, `.strix` encryption, blocking
`--remote-debugging-port`. Geotech is not a target-rich piracy environment; every
one of those costs support pain and buys a delay, not protection.

---

## What we need from you before stage 2 starts

1. **Grace-window length** — 30 days proposed. Shorter is tighter, longer is
   friendlier to a month-long site campaign.
2. **Machine binding: how many devices per Solo seat?** 2 (laptop + desktop) is
   the industry norm and avoids most support tickets.
3. **Trial mechanics** — is the 30-day trial licensed the same way (server-issued
   trial licence), or is it just an unlicensed build with tonight's expiry?
4. **Where diagnostics go** (debt #16) — the same server, or nowhere. If the
   activation server exists, a crash-report endpoint on it is nearly free; if
   there is no server, crash reports stay manual forever.
