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

## Kamado Sumo template library

The campaign editor and journey email steps include **Choose template**, with a preview before applying and **Undo template** during editing. Fifteen portable HTML templates reuse Kamado's approved email design: welcome, grill choice, inspiration, after purchase, product/campaign and two abandoned-cart emails in Swedish and English, plus a bilingual language-choice email. Applying replaces only the subject, preview text and body. Campaigns autosave; journeys require Save changes. Active journeys remain read-only. The library is a starting point: existing emails retain their saved copy when the library changes. Choose **Edit email visually** to edit headings and formatted text in place, change images and destinations, and add, duplicate, remove or reorder heading, text, image, button and editorial product blocks. Drag a handle or use the accessible move buttons. Undo/redo and desktop/mobile canvas sizes are included. Brand header, colours and legal footer remain shared. Legacy HTML emails without a saved design retain their source editor.

The static catalog is `lib/email-templates.json`, and compiled templates are in `public/email-templates/`. Only the chosen template is loaded. Cart templates are offered exclusively in abandoned-cart journeys. Template language is explicit and does not change a contact's language or translate automatically. Set the newsletter's real postal address, sender and reply-to before use. `{{postal_address}}` is HTML-escaped by the renderer. Signed unsubscribe URLs and cart recovery links are filled through the existing sending path, including the Outlook button fallback.

Source content and the builder live in the Kamado workspace at `Email/mailman/`; they reuse the original shared email renderer and active brand profile rather than copying the layout. Runtime use of the compiled templates does not require that workspace or Python. Rebuild there and commit the HTML, editable JSON, catalog and `lib/email-design-assets.json` together after shared design changes. The builder exports reusable fragments from the shared renderer; `tools/build-email-designs.mjs` compiles the same structures used by the editor. Campaigns and journey steps persist their versioned design with compiled HTML. Server saves validate and sanitize the design, then regenerate HTML rather than trusting client HTML. Published run snapshots keep the original compiled content. Image uploads reuse the existing upload route and require configured Blob storage; public HTTPS image addresses also work. Owner emails require confirmed delivery: the existing paid-order trigger does not prove delivery. Language preferences are requested by email reply and updated manually. Product images/prices are editorial, not automatically populated from a cart. No production installation or test delivery is included.


## Recovered purchases and order value

Abandoned-cart flow pages include an all-time recovery report: sent emails, recovered paid orders, orders per sent email, order value per currency and per email step, plus the latest 30 attributed orders. Sent counts are messages accepted for sending, not unique customers. Email steps are grouped by their stable node ID across revisions; saved run/message labels preserve renamed or removed steps.

Attribution uses `cart-link-7d`, not email-only matching. A signed message-specific `mailman_attribution` token is added to the personalized `{{checkoutUrl}}`, including plain text and the Outlook VML button. The customer must open a valid cart restoration link within seven days of sending, then place an order within seven days of that visit. A later payment can qualify, but an order outside the placement window cannot. At least one original product/variation must remain in the order. The shop, newsletter, recipient, original cart identity, cart version and currency must all match the sent message's run snapshot. This is attributed order value, not proof of incremental sales or only the value of restored line items.

WooCommerce adapter **0.2.0** captures the latest valid restoration visit in the existing Woo session only with advertising consent. Classic and Block checkout copy it to native order metadata, including the actual checkout timestamp for older Block checkout drafts. Checkout retries retain the first attribution saved on that order. The session touch is consumed after checkout, expires after seven days, and is cleared on consent revocation or a billing-email mismatch. Opening a recovery link on another device requires opening that link on that device before checkout. Ordinary purchases with the same email receive no attribution. Historical imports, old links, and run snapshots created before this feature are excluded; there is no guessed backfill.

The commerce worker verifies the signature and identity before assigning credit. A unique database index allows one recovered order per original cart version, including across flows and concurrent retries. Refunding that order does not release the cart for attribution to another purchase. Repeated events do not increment revenue. Reports aggregate the current paid records, so partial refunds reduce value and cancelled/fully refunded orders contribute zero orders and value while remaining in recent history. Order value is the full WooCommerce order total after refunds, **including tax and shipping**. Currencies are never added together or converted. Event processing remains asynchronous; reports update after the commerce worker applies the event.

Install the updated adapter and Mailman together on staging before launch. Keep feature switches off until the existing checkout, consent, event delivery and signed worker checks have been verified. No live shop installation, real order or email delivery is performed by the local preview/tests. Secret rotation invalidates previously issued recovery tokens, as with other signed email links. Redact both `mailman_recover` and `mailman_attribution` from access logs. Include order attribution metadata in existing export/deletion procedures.

Checkout integration reference: [WooCommerce Store API checkout hook](https://woocommerce.github.io/code-reference/files/woocommerce-src-storeapi-routes-v1-checkout.html).
