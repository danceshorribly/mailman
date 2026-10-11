<?php
// No WordPress installation or mail delivery. Run with PHP 8.1 or later.
define('ABSPATH', '/tmp/');
define('DAY_IN_SECONDS', 86400);
function register_activation_hook(...$args) {}
function register_deactivation_hook(...$args) {}
function add_action(...$args) {}
function apply_filters($name, $value, ...$args) { return $name === 'mailman_cart_capture_allowed' ? ($GLOBALS['consent'] ?? false) : ($name === 'wpml_current_language' ? 'sv' : $value); }
function get_woocommerce_currency() { return 'SEK'; }
class FakeSession { public array $data = []; public function get($key, $default = null) { return $this->data[$key] ?? $default; } public function set($key, $value) { $this->data[$key] = $value; } }
$GLOBALS['woo'] = (object) ['session' => new FakeSession()];
function WC() { return $GLOBALS['woo']; }
function wp_json_encode($value, $flags = 0) { return json_encode($value, $flags); }
function get_locale() { return 'sv_SE'; }
class WC_Order {
    public function __construct(public string $status = 'on-hold', public float $refund = 0, public bool $paid = true) {}
    public array $meta = [];
    public string $email = 'Alex@example.com';
    public function get_billing_email() { return $this->email; }
    public function update_meta_data($key, $value) { $this->meta[$key] = $value; }
    public function delete_meta_data($key) { unset($this->meta[$key]); }
    public function get_status() { return $this->status; }
    public function get_date_paid() { return $this->paid ? new DateTimeImmutable('2026-10-10T12:00:00Z') : null; }
    public function get_date_created() { return new DateTimeImmutable('2026-10-09T10:00:00Z'); }
    public function get_date_modified() { return new DateTimeImmutable('2026-10-10T12:00:00Z'); }
    public function has_status($statuses) { return in_array($this->status, (array) $statuses, true); }
    public function get_items() { return []; }
    public function get_meta($name) { return $this->meta[$name] ?? ($name === '_kamado_legacy_order_id' ? 1234 : ($name === 'wpml_language' ? 'sv' : '')); }
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
$GLOBALS['consent'] = true;
$saved = ['id' => 'cart-1', 'version' => MailmanWoo\iso(time() - 3600), 'email' => 'alex@example.com', 'currency' => 'SEK'];
$token = str_repeat('a', 24) . '.' . str_repeat('b', 43);
MailmanWoo\capture_recovery_touch($saved, $token);
$touch = WC()->session->get('mailman_recovery_touch');
check($touch['token'] === $token && $touch['cartExternalId'] === 'cart-1', 'Valid restored cart installs a session touch');
$order = new WC_Order('pending', 0, false);
MailmanWoo\attach_recovery_touch($order);
check($order->get_meta('_mailman_recovery_touch')['token'] === $token, 'Native order metadata receives the recovery touch');
$event = MailmanWoo\order_event($order);
check($event['data']['recoveryTouch']['token'] === $token, 'Live order sync includes recovery metadata');
check(!isset($event['data']['recoveryTouch']['email']) && !isset($event['data']['recoveryTouch']['placedAt']), 'Private session fields stay out of attribution payload');
check(strtotime($event['data']['placedAt']) >= strtotime($touch['touchedAt']), 'Old block checkout drafts use actual checkout time');
check(!isset(MailmanWoo\order_event($order, true)['data']['recoveryTouch']), 'Historical imports never claim recovery');
MailmanWoo\capture_recovery_touch($saved, str_repeat('c', 24) . '.' . str_repeat('d', 43));
MailmanWoo\attach_recovery_touch($order);
check($order->get_meta('_mailman_recovery_touch')['token'] === $token, 'Checkout retries preserve order attribution');
MailmanWoo\clear_recovery_touch($order);
check(WC()->session->get('mailman_recovery_touch') === null, 'Finalized checkout consumes the session touch');
MailmanWoo\capture_recovery_touch($saved, $token);
$wrong = new WC_Order('pending', 0, false); $wrong->email = 'another@example.com';
MailmanWoo\attach_recovery_touch($wrong);
check(!$wrong->get_meta('_mailman_recovery_touch'), 'Different billing customer cannot inherit recovery');
check(WC()->session->get('mailman_recovery_touch') === null, 'Identity mismatch clears the session touch');
MailmanWoo\capture_recovery_touch($saved, $token);
$expired = WC()->session->get('mailman_recovery_touch'); $expired['touchedAt'] = MailmanWoo\iso(time() - 8 * DAY_IN_SECONDS);
WC()->session->set('mailman_recovery_touch', $expired);
MailmanWoo\attach_recovery_touch(new WC_Order());
check(WC()->session->get('mailman_recovery_touch') === null, 'Expired attribution is removed');
MailmanWoo\capture_recovery_touch($saved, $token);
$GLOBALS['consent'] = false;
MailmanWoo\attach_recovery_touch($order);
check(!$order->get_meta('_mailman_recovery_touch'), 'Consent revocation removes attribution before checkout');
check(WC()->session->get('mailman_recovery_touch') === null, 'Consent revocation clears the session');
MailmanWoo\capture_recovery_touch($saved, $token);
check(WC()->session->get('mailman_recovery_touch') === null, 'No touch is captured without consent');
$GLOBALS['consent'] = true;
MailmanWoo\capture_recovery_touch($saved, $token);
MailmanWoo\capture_recovery_touch($saved, 'forged');
check(WC()->session->get('mailman_recovery_touch') === null, 'Invalid newer link clears earlier attribution');
MailmanWoo\capture_recovery_touch([...$saved, 'currency' => 'EUR'], $token);
check(WC()->session->get('mailman_recovery_touch') === null, 'Currency mismatch is not attributed');
check(MailmanWoo\order_event(new WC_Order('processing', 1000))['data']['status'] === 'refunded', 'A full refund is excluded even if the shop retains processing status');
echo "27 WooCommerce adapter assertions passed. No orders or emails created.\n";
