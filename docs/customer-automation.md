# Mailman customer automation

This extension adds customer profiles, dynamic segments, campaign audience selection, durable journeys and a WooCommerce event adapter. No migration, production installation or real email delivery is performed by installing these source changes. New flows start as drafts. The app keeps using the original SES delivery, signed unsubscribe links, tracking and bounce/complaint handling.

## Capabilities

- Profiles: first name, last name, full name, language, country, tags, paid order count, purchased product IDs, last purchase and net spend by currency.
- Segments: nested AND/OR groups, approved fields and operators, relative dates and a live audience preview. Missing data does not satisfy negative comparisons. Campaigns can select a saved segment. The audience is frozen into messages when a send is queued; subscription and suppression status are checked again before delivery.
- Journeys: new subscriber, paid order and abandoned cart triggers. Email, wait, if/else, add tag and finish steps. Every path must terminate. Cycles, unknown steps and unreachable steps are rejected.
- Email steps support Markdown or existing HTML templates, personalization, previews and the shared unsubscribe renderer. Use `{{firstName}}`, `{{lastName}}`, `{{fullName}}` and, in cart flows, `{{checkoutUrl}}`. Missing names become empty text. Customer names cannot fill HTML attributes.
- Commerce: store-bound API authentication, an event journal, retry/backoff, historical import mode, native order IDs and optional Kamado legacy IDs. SEK and EUR totals are kept separate. Full refunds cease to count as purchases; partial refunds reduce net spend.
- Visibility: customer order history, per-run step history, failed events and integration enable/disable controls. Excessive bounce or complaint rates pause a journey, using the original sender thresholds over its last 30 days.

The flow editor uses explicit Next, Yes and No connections. It is keyboard accessible and responsive. It does not implement a drag-and-drop canvas. Segment entry triggers, product recommendations, coupon creation and SMS are not included.

## Local development and verification

Use Node 22.13 or later, preferably Node 24 LTS.

```sh
npm ci
npm test
npm run lint
npm run build
php tests/woocommerce-adapter.php
```

The integration tests start a disposable MongoDB server and stub email delivery. The first test run downloads the MongoDB executable. No SES credentials or production database are used. The PHP tests stub WordPress and WooCommerce, exercising payload mapping without creating orders or sending mail.

For a local interface with synthetic contacts, a sample segment and a branching cart flow:

```sh
node tools/preview-automations.mjs
```

Open `http://localhost:3417`. The terminal shows the disposable login. Both automation and sending switches are forcibly off. Stopping the process removes the database. This preview is not a staging migration.

## Runtime and background worker

The app needs Node, persistent MongoDB, SES and signed QStash callbacks. A shared web hosting account without MongoDB must use a separate MongoDB service. Host compatibility, startup, restarts, TLS, backups and scheduler access must be verified on the chosen deployment before cutover.

Set the existing required environment variables in `.env.example`, plus:

```dotenv
SENDING_ENABLED=false
AUTOMATIONS_ENABLED=false
```

Configure QStash and the public HTTPS `APP_URL`. In Commerce, register the minute worker schedule. This updates a stable schedule ID instead of creating a new schedule every time. Production `/api/jobs/automations` verifies QStash signatures. Development retains the upstream unsigned local job behavior.

`AUTOMATIONS_ENABLED=true` processes events and advances non-email steps. With sending off, journeys wait at their email steps. Both switches must be true to deliver flow emails. The database lease excludes concurrent workers. Crashed workers are recoverable after the ten-minute lease expires. A minute tick is limited to 40 seconds, 100 events, 50 due carts and 100 steps. Large imports can take several ticks.

Saving an active flow is rejected. Pause, edit, save, then activate. Existing runs keep a snapshot of the definition they entered with. Pausing preserves waiting runs; new events processed during a pause do not enroll. Activation applies to future events, with no automatic broadcast to existing subscribers or old carts. If the worker is disabled, queued events retain their original event time when processed later.

Email records are unique per run and step. As in the original app, delivery is claimed before calling SES to avoid automatic duplicates. A crash or an ambiguous provider failure can leave delivery uncertain. Those runs fail for manual review and are not automatically resent. This is not an exactly-once provider guarantee.

## WooCommerce adapter

Install the `integrations/woocommerce` directory as one WordPress plugin only after a server backup and staging verification. It requires WooCommerce and uses its bundled Action Scheduler. It does not replace transaction/order emails or change order statuses, prices, payments, templates or Elementor form actions.

Create an API key in Mailman. Register a shop in Commerce with its newsletter, that key and its exact HTTPS origin. Add the resulting endpoint and key to private server configuration, never to a theme, repository, frontend script or browser URL:

```php
define('MAILMAN_COMMERCE_ENDPOINT', 'https://mail.example.com/api/v1/commerce/SHOP_OBJECT_ID');
define('MAILMAN_API_KEY', 'PRIVATE_MAILMAN_API_KEY');
```

The endpoint accepts only the key bound to that shop. Keep the registered origin equal to the real shop origin, including `www`. Recovery links on any other host are rejected.

The adapter queues order placement, payment, status changes and refunds using WooCommerce order methods. Classic checkout and Checkout Block order hooks are both covered. Checkout drafts are ignored. A paid date takes precedence over historical `on-hold` statuses. `_kamado_legacy_order_id`, when present, becomes the stable external identity. Product segments use canonical WPML product IDs.

Cart capture uses the WooCommerce session and known checkout email. Classic checkout updates and the supplied checkout script support capture; existing captured sessions update when cart totals change. Kamado Consent's server-verified advertising permission gates capture. Browser consent alone cannot subscribe a customer. Unknown commerce contacts remain dormant and get no marketing. Generic stores can supply a server-side `mailman_cart_capture_allowed` filter and corresponding frontend consent adapter. Do not enable capture without the appropriate consent integration and current purpose text.

An inactive cart becomes eligible after one hour. Recovery tokens expire after seven days, are opaque, and restore only product/variation/quantity data. WooCommerce validates current stock and prices. Recovery merges missing items into an existing cart and never empties an unrelated cart. The localized recovery URL is retained; current storefront currency/pricing rules apply at recovery time. Custom cart item add-on metadata and old coupons are not restored.

Order receipt stops older cart snapshots immediately. Changed or closed cart receipt retires the old snapshot before its journal event is processed. Each email rechecks contact eligibility, cart version, expiry, shop state and later order placement. There is still an unavoidable interval between the final check and provider delivery. No system can retract a message SES has already accepted.

Payloads are stored in a private WordPress outbox. Only event IDs enter Action Scheduler arguments. Retries use exponential backoff; invalid/authentication failures and exhausted retries appear in the `mailman` WooCommerce log without payloads or secrets. The hourly outbox sweep recovers unscheduled pending entries. Configure a real WordPress cron runner. Fix the cause, then run `wp mailman retry-failed` to retry.

Historical order import is explicit and paginated:

```sh
wp mailman import-orders --page=1
```

Each page queues up to 100 orders, marked historical. Continue until the returned count is zero. Importing is idempotent by external identity and version. It does not trigger purchase journeys or alter WooCommerce orders.

API example:

```json
{
  "id": "order:stable-event-id",
  "type": "order.updated",
  "historical": false,
  "data": {
    "externalId": "wc:1234",
    "email": "customer@example.com",
    "updatedAt": "2026-10-11T10:00:00.000Z",
    "placedAt": "2026-10-11T09:58:00.000Z",
    "paidAt": "2026-10-11T09:59:00.000Z",
    "status": "paid",
    "currency": "SEK",
    "total": 2495,
    "items": [{ "productId": "314", "quantity": 1 }],
    "profile": { "firstName": "Alex", "language": "sv", "country": "SE" }
  }
}
```

Use one stable ID per event and retry its exact payload. Order statuses are `placed`, `paid`, `cancelled`, `refunded`; cart statuses are `open`, `closed`. Open carts additionally need `checkoutUrl` and `expiresAt`. Requests are limited to 100 KB and 100 items. Stale versions cannot overwrite newer records. The member signup endpoint also accepts a `profile` object with customer fields.

## Mailchimp migration

The CSV importer now maps FNAME, LNAME, FULLNAME, COUNTRY, LANGUAGE and Tags. Swedish/English and the other supported language names normalize to language codes. Tags are merged; a plain CSV without a tags column does not erase existing tags. Existing opt-outs, bounces, complaints and confirmation-pending statuses are not reactivated.

A direct member importer uses Mailchimp's paginated read API. Pass secrets through the environment or a private ignored environment file. It prints counts only, without addresses, merge values or credentials. Run a dry run first:

```sh
node --env-file=.env.migration tools/import-mailchimp.mjs --list=LIST_ID
```

After a database backup, both feature switches off, and a target newsletter created:

```sh
node --env-file=.env.migration tools/import-mailchimp.mjs --list=LIST_ID --newsletter=NEWSLETTER_OBJECT_ID --apply
```

It preserves source identity, opt-in timestamp when present, last change timestamp, names, tags, language, country and engagement rates. Only Mailchimp `subscribed` becomes active for a new contact. Transactional, pending, archived and unknown statuses become dormant; cleaned contacts become bounced. Existing stricter statuses win. Importing creates no signup events and sends no welcome messages.

Each page prints its cutoff. Resume with the same `--before=TIMESTAMP` and `--offset=N`. Mailchimp offset pagination is not a transactional snapshot: changes during migration can move records. Freeze Mailchimp campaign/form changes for cutover, run the initial import, then reconcile with `--since=TIMESTAMP` and verify aggregate statuses and sample records before enabling Mailman. This command imports members, not existing Mailchimp journey definitions, archived campaigns or their reports. Rebuild journeys in Mailman and move forms in a separate verified cutover.

## Data and operations

The event journal stores payloads for 90 days after processing. Orders, carts, run snapshots, messages and profile migration provenance remain until an explicit retention/deletion process removes them. Include these collections and the WordPress outbox in customer data export/deletion procedures. Do not log event bodies or commit customer exports. Recovery tokens should be redacted from access logs.

Verify on staging before launch: real shop event delivery, signed background callbacks, classic/block checkout used by the shop, consent revocation, localized recovery links, current currency/stock, opt-out and SES delivery/bounce events. Browser checks and synthetic tests cannot verify those production dependencies. Keep Mailchimp running until counts, forms, DNS authentication and end-to-end delivery are reconciled. Do not run both systems' cart journeys simultaneously.

References: [Mailchimp member API](https://mailchimp.com/developer/marketing/api/lists/members/list-members), [WooCommerce hooks](https://woocommerce.github.io/code-reference/hooks/hooks), [Checkout Block hook differences](https://github.com/woocommerce/woocommerce/blob/trunk/docs/block-development/reference/hooks/hook-alternatives.md), [Action Scheduler API](https://github.com/woocommerce/action-scheduler/blob/trunk/docs/api.md).
