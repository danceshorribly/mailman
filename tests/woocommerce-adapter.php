<?php
// No WordPress installation or mail delivery. Run with PHP 8.1 or later.
define('ABSPATH', '/tmp/');
define('DAY_IN_SECONDS', 86400);
function register_activation_hook(...$args) {}
function register_deactivation_hook(...$args) {}
function add_action(...$args) {}
function apply_filters($name, $value, ...$args) { return $name === 'wpml_current_language' ? 'sv' : $value; }
function wp_json_encode($value, $flags = 0) { return json_encode($value, $flags); }
function get_locale() { return 'sv_SE'; }
class WC_Order {
    public function __construct(public string $status = 'on-hold', public float $refund = 0, public bool $paid = true) {}
    public function get_billing_email() { return 'Alex@example.com'; }
    public function get_status() { return $this->status; }
    public function get_date_paid() { return $this->paid ? new DateTimeImmutable('2026-10-10T12:00:00Z') : null; }
    public function get_date_created() { return new DateTimeImmutable('2026-10-09T10:00:00Z'); }
    public function get_date_modified() { return new DateTimeImmutable('2026-10-10T12:00:00Z'); }
    public function has_status($statuses) { return in_array($this->status, (array) $statuses, true); }
    public function get_items() { return []; }
    public function get_meta($name) { return $name === '_kamado_legacy_order_id' ? 1234 : ($name === 'wpml_language' ? 'sv' : ''); }
    public function get_id() { return 99999; }
    public function get_currency() { return 'SEK'; }
    public function get_total() { return 1000; }
    public function get_total_refunded() { return $this->refund; }
    public function get_billing_first_name() { return 'Alex'; }
    public function get_billing_last_name() { return 'Sumo'; }
    public function get_billing_country() { return 'SE'; }
}
require __DIR__ . '/../integrations/woocommerce/mailman-woocommerce.php';
function check($condition, $message) { if (!$condition) throw new RuntimeException($message); }
$event = MailmanWoo\order_event(new WC_Order(), true);
check($event['data']['status'] === 'paid', 'A paid date wins over an old on-hold status');
check($event['data']['externalId'] === 'wc:1234', 'Legacy order identity must survive migration');
check($event['data']['email'] === 'alex@example.com', 'Emails are normalized');
check($event['historical'] === true, 'History is explicitly marked');
check($event['data']['profile']['language'] === 'sv', 'Order language is retained');
check(MailmanWoo\order_event(new WC_Order('processing', 200), true)['data']['total'] === 800.0, 'Partial refunds reduce net spend');
check(MailmanWoo\order_event(new WC_Order('refunded', 1000), true)['data']['status'] === 'refunded', 'Full refunds override paid dates');
check(MailmanWoo\order_event(new WC_Order('pending', 0, false), true)['data']['status'] === 'placed', 'Unpaid orders are not paid');
check(MailmanWoo\order_event(new WC_Order('checkout-draft'), true) === null, 'Block checkout drafts do not cancel carts or enroll journeys');
check(MailmanWoo\cart_permission() === false, 'Cart capture is closed without consent provider');
echo "10 WooCommerce adapter assertions passed. No orders or emails created.\n";
