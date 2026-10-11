<?php
/**
 * Plugin Name: Mailman for WooCommerce
 * Description: Durable order and consent-gated cart sync to a self-hosted Mailman instance.
 * Version: 0.2.0
 * Requires Plugins: woocommerce
 * Requires PHP: 8.1
 */
namespace MailmanWoo;
defined('ABSPATH') || exit;
add_action('before_woocommerce_init', function () {
    if (class_exists('Automattic\\WooCommerce\\Utilities\\FeaturesUtil')) {
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('custom_order_tables', __FILE__, true);
    }
});

function configured(): bool {
    return defined('MAILMAN_COMMERCE_ENDPOINT') && defined('MAILMAN_API_KEY')
        && str_starts_with(MAILMAN_COMMERCE_ENDPOINT, 'https://') && MAILMAN_API_KEY !== '';
}
function table(): string { global $wpdb; return $wpdb->prefix . 'mailman_outbox'; }
function install(): void {
    global $wpdb;
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    $table = table(); $collate = $wpdb->get_charset_collate();
    dbDelta("CREATE TABLE $table (
        id varchar(64) NOT NULL,
        payload longtext NOT NULL,
        status varchar(16) NOT NULL DEFAULT 'pending',
        attempts int NOT NULL DEFAULT 0,
        next_at bigint NOT NULL DEFAULT 0,
        last_code int NOT NULL DEFAULT 0,
        created_at bigint NOT NULL,
        PRIMARY KEY  (id),
        KEY due (status,next_at)
    ) $collate;");
    if (!wp_next_scheduled('mailman_outbox_sweep')) wp_schedule_event(time() + 60, 'hourly', 'mailman_outbox_sweep');
}
register_activation_hook(__FILE__, __NAMESPACE__ . '\\install');
register_deactivation_hook(__FILE__, function () { wp_clear_scheduled_hook('mailman_outbox_sweep'); });

function enqueue(array $event): void {
    if (!configured()) return;
    global $wpdb;
    $json = wp_json_encode($event, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $id = hash('sha256', $event['id']);
    $wpdb->query($wpdb->prepare('INSERT IGNORE INTO ' . table() . ' (id,payload,created_at) VALUES (%s,%s,%d)', $id, $json, time()));
    if (function_exists('as_enqueue_async_action')) as_enqueue_async_action('mailman_deliver', [$id], 'mailman', true);
}
function deliver(string $id): void {
    if (!configured() || !preg_match('/^[a-f0-9]{64}$/', $id)) return;
    global $wpdb;
    $row = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . table() . ' WHERE id=%s AND status=%s AND next_at<=%d', $id, 'pending', time()));
    if (!$row) return;
    $response = wp_safe_remote_post(MAILMAN_COMMERCE_ENDPOINT, [
        'timeout' => 20, 'redirection' => 0,
        'headers' => ['Authorization' => 'Bearer ' . MAILMAN_API_KEY, 'Content-Type' => 'application/json'],
        'body' => $row->payload,
    ]);
    $code = is_wp_error($response) ? 0 : wp_remote_retrieve_response_code($response);
    if ($code >= 200 && $code < 300) {
        $wpdb->delete(table(), ['id' => $id]); return;
    }
    $attempts = (int) $row->attempts + 1;
    $failed = $attempts >= 12 || in_array($code, [400, 401, 403, 404, 413], true);
    $at = time() + min(3600, 30 * (2 ** min($attempts, 7)));
    $wpdb->update(table(), ['attempts' => $attempts, 'status' => $failed ? 'failed' : 'pending', 'last_code' => $code, 'next_at' => $at], ['id' => $id]);
    if (!$failed && function_exists('as_schedule_single_action')) as_schedule_single_action($at, 'mailman_deliver', [$id], 'mailman', true);
    // Only status codes are logged. Payloads, recovery links and credentials stay out of logs.
    if ($failed && function_exists('wc_get_logger')) wc_get_logger()->error('Event delivery failed, HTTP ' . $code, ['source' => 'mailman']);
}
add_action('mailman_deliver', __NAMESPACE__ . '\\deliver');
add_action('mailman_outbox_sweep', function () {
    global $wpdb;
    if (!configured() || !function_exists('as_enqueue_async_action')) return;
    foreach ($wpdb->get_col($wpdb->prepare('SELECT id FROM ' . table() . ' WHERE status=%s AND next_at<=%d LIMIT 100', 'pending', time())) as $id) {
        as_enqueue_async_action('mailman_deliver', [$id], 'mailman', true);
    }
});

function iso(?int $timestamp = null): string { return gmdate('Y-m-d\TH:i:s', $timestamp ?? time()) . '.000Z'; }
function millisecond_iso(): string {
    $now = microtime(true); return gmdate('Y-m-d\TH:i:s', (int) $now) . sprintf('.%03dZ', (int) (($now - floor($now)) * 1000));
}
function language(): string { return (string) apply_filters('wpml_current_language', null) ?: substr(get_locale(), 0, 2); }
function product_id(int $id): string {
    // Use the canonical WPML product, so segments match across translated product IDs.
    return (string) apply_filters('wpml_object_id', $id, 'product', true, apply_filters('wpml_default_language', null));
}
function order_event($order, bool $historical = false): ?array {
    if (!$order instanceof \WC_Order || !$order->get_billing_email() || $order->get_status() === 'checkout-draft') return null;
    $paid = $order->get_date_paid();
    $fully_refunded = (float) $order->get_total() > 0 && (float) $order->get_total_refunded() >= (float) $order->get_total();
    $status = ($order->has_status('refunded') || $fully_refunded) ? 'refunded' : ($order->has_status(['cancelled', 'failed']) ? 'cancelled' : ($paid ? 'paid' : 'placed'));
    $items = [];
    foreach ($order->get_items() as $item) {
        $items[] = ['productId' => product_id($item->get_product_id()), 'variationId' => (string) $item->get_variation_id(), 'name' => $item->get_name(), 'quantity' => (int) $item->get_quantity()];
    }
    $legacy = $order->get_meta('_kamado_legacy_order_id');
    $data = [
        'externalId' => 'wc:' . ($legacy ?: $order->get_id()), 'email' => strtolower($order->get_billing_email()),
        'updatedAt' => $historical ? iso(($order->get_date_modified() ?: $order->get_date_created())->getTimestamp()) : millisecond_iso(),
        'placedAt' => iso($order->get_date_created()->getTimestamp()),
        'status' => $status, 'currency' => $order->get_currency(),
        // Partial refunds reduce net spend, without converting currencies or changing Woo orders.
        'total' => max(0, (float) $order->get_total() - (float) $order->get_total_refunded()), 'items' => $items,
        'profile' => ['firstName' => $order->get_billing_first_name(), 'lastName' => $order->get_billing_last_name(), 'country' => $order->get_billing_country(), 'language' => $order->get_meta('wpml_language') ?: language()],
    ];
    $recovery = $order->get_meta('_mailman_recovery_touch');
    if (!$historical && is_array($recovery) && !empty($recovery['token'])) {
        // Block checkout drafts can predate the return visit. Preserve the actual checkout touch time.
        $data['placedAt'] = max($data['placedAt'], $recovery['placedAt']);
        unset($recovery['email'], $recovery['placedAt']);
        $data['recoveryTouch'] = $recovery;
    }
    if ($status === 'paid') $data['paidAt'] = max(iso($paid->getTimestamp()), $data['placedAt']);
    return ['id' => 'order:' . hash('sha256', wp_json_encode($data) . ($historical ? ':history' : '')), 'type' => 'order.updated', 'historical' => $historical, 'data' => $data];
}
function sync_order($id): void {
    if (!configured()) return;
    $order = $id instanceof \WC_Order ? $id : wc_get_order($id);
    $event = order_event($order);
    if ($event) enqueue($event);
}
add_action('woocommerce_checkout_order_processed', __NAMESPACE__ . '\\sync_order', 20, 1);
add_action('woocommerce_store_api_checkout_order_processed', __NAMESPACE__ . '\\sync_order', 20, 1);
add_action('woocommerce_payment_complete', __NAMESPACE__ . '\\sync_order', 20, 1);
add_action('woocommerce_order_status_changed', __NAMESPACE__ . '\\sync_order', 20, 1);
add_action('woocommerce_order_refunded', __NAMESPACE__ . '\\sync_order', 20, 1);

function cart_permission(): bool {
    $allowed = function_exists('KamadoConsent\\allows') && \KamadoConsent\allows('advertising');
    return (bool) apply_filters('mailman_cart_capture_allowed', $allowed);
}
// Attribution uses the existing consent-gated Woo session. No extra tracking cookie is created.
function capture_recovery_touch(array $saved, string $token): void {
    if (!WC()->session) return;
    // A newer recovery visit replaces an earlier touch, including visits without a valid token.
    WC()->session->set('mailman_recovery_touch', null);
    if (!cart_permission() || !preg_match('/^[a-f0-9]{24}\.[A-Za-z0-9_-]{43}$/', $token)
        || empty($saved['id']) || empty($saved['version']) || empty($saved['email'])
        || ($saved['currency'] ?? '') !== get_woocommerce_currency()) return;
    WC()->session->set('mailman_recovery_touch', [
        'token' => $token, 'cartExternalId' => $saved['id'], 'cartVersion' => $saved['version'],
        'touchedAt' => millisecond_iso(), 'email' => strtolower($saved['email']),
    ]);
}
function attach_recovery_touch($order): void {
    if (!$order instanceof \WC_Order || !WC()->session) return;
    if (!cart_permission()) {
        WC()->session->set('mailman_recovery_touch', null);
        $order->delete_meta_data('_mailman_recovery_touch');
        return;
    }
    // Checkout/payment retries keep the first order attribution unchanged.
    if ($order->get_meta('_mailman_recovery_touch')) return;
    $touch = WC()->session->get('mailman_recovery_touch');
    if (!$touch) return;
    $at = strtotime($touch['touchedAt']);
    if (!$at || $at > time() || time() - $at > 7 * DAY_IN_SECONDS
        || strtolower($order->get_billing_email()) !== $touch['email']) {
        WC()->session->set('mailman_recovery_touch', null); return;
    }
    $touch['placedAt'] = millisecond_iso();
    $order->update_meta_data('_mailman_recovery_touch', $touch);
}
function clear_recovery_touch($id): void {
    $order = $id instanceof \WC_Order ? $id : wc_get_order($id);
    if ($order instanceof \WC_Order && $order->get_status() !== 'checkout-draft'
        && $order->get_meta('_mailman_recovery_touch') && WC()->session) {
        WC()->session->set('mailman_recovery_touch', null);
    }
}
add_action('woocommerce_checkout_create_order', __NAMESPACE__ . '\\attach_recovery_touch', 20, 1);
add_action('woocommerce_store_api_checkout_update_order_meta', __NAMESPACE__ . '\\attach_recovery_touch', 20, 1);
add_action('woocommerce_checkout_order_processed', __NAMESPACE__ . '\\clear_recovery_touch', 30, 1);
add_action('woocommerce_store_api_checkout_order_processed', __NAMESPACE__ . '\\clear_recovery_touch', 30, 1);

function cart_snapshot(string $email, array $profile = []): void {
    if (!configured() || !WC()->session || !WC()->cart) return;
    $state = WC()->session->get('mailman_cart', []);
    $profile = array_merge($state['profile'] ?? [], array_filter($profile, static fn($value) => $value !== ''));
    $allowed = cart_permission();
    if (!$allowed) WC()->session->set('mailman_recovery_touch', null);
    if (!$allowed || WC()->cart->is_empty()) {
        if (!$state) return;
        $email = $state['email'];
        $profile = []; $items = []; $total = 0;
    } else {
        if (!is_email($email)) return;
        $email = strtolower($email); $items = [];
        foreach (WC()->cart->get_cart() as $line) {
            $items[] = ['productId' => product_id((int) $line['product_id']), 'variationId' => (string) $line['variation_id'], 'name' => $line['data']->get_name(), 'quantity' => (int) $line['quantity']];
        }
        $total = (float) WC()->cart->get_total('edit');
    }
    $status = $allowed && $items ? 'open' : 'closed';
    $hash = hash('sha256', wp_json_encode([$email, $items, $total, get_woocommerce_currency(), $profile, $status]));
    if (($state['hash'] ?? '') === $hash) return;
    // Changing identity creates a new cart and closes the old identity first.
    if ($state && $state['email'] !== $email) {
        enqueue(['id' => 'cart-close:' . wp_generate_uuid4(), 'type' => 'cart.updated', 'data' => ['externalId' => $state['id'], 'email' => $state['email'], 'updatedAt' => millisecond_iso(), 'currency' => get_woocommerce_currency(), 'total' => 0, 'items' => [], 'status' => 'closed']]);
        if (!empty($state['token'])) delete_transient('mailman_recover_' . $state['token']);
        $state = [];
    }
    $id = $state['id'] ?? wp_generate_uuid4();
    $version = millisecond_iso();
    $data = ['externalId' => $id, 'email' => $email, 'updatedAt' => $version, 'currency' => get_woocommerce_currency(), 'total' => $total, 'items' => $items, 'status' => $status, 'profile' => $profile];
    if (!empty($state['token'])) delete_transient('mailman_recover_' . $state['token']);
    $token = '';
    if ($status === 'open') {
        $token = bin2hex(random_bytes(32));
        $restore = [];
        foreach (WC()->cart->get_cart() as $line) $restore[] = ['product_id' => (int) $line['product_id'], 'variation_id' => (int) $line['variation_id'], 'variation' => $line['variation'], 'quantity' => (int) $line['quantity']];
        set_transient('mailman_recover_' . $token, ['items' => $restore, 'currency' => get_woocommerce_currency(), 'id' => $id, 'version' => $version, 'email' => $email], 7 * DAY_IN_SECONDS);
        $data['checkoutUrl'] = add_query_arg('mailman_recover', $token, wc_get_cart_url());
        $data['expiresAt'] = iso(time() + 7 * DAY_IN_SECONDS);
    }
    enqueue(['id' => 'cart:' . hash('sha256', $id . $version . $hash), 'type' => 'cart.updated', 'data' => $data]);
    WC()->session->set('mailman_cart', ['id' => $id, 'email' => $email, 'hash' => $hash, 'token' => $token, 'profile' => $profile]);
}
add_action('woocommerce_checkout_update_order_review', function ($raw) {
    parse_str($raw, $posted);
    cart_snapshot(sanitize_email($posted['billing_email'] ?? ''), ['firstName' => sanitize_text_field($posted['billing_first_name'] ?? ''), 'lastName' => sanitize_text_field($posted['billing_last_name'] ?? ''), 'country' => sanitize_text_field($posted['billing_country'] ?? ''), 'language' => language()]);
});
add_action('woocommerce_after_calculate_totals', function () {
    if (WC()->session && ($state = WC()->session->get('mailman_cart'))) cart_snapshot($state['email']);
}, 30);
add_action('woocommerce_cart_emptied', function () { cart_snapshot(''); });
add_action('wc_ajax_mailman_cart', function () {
    check_ajax_referer('mailman_cart', 'nonce');
    cart_snapshot(sanitize_email(wp_unslash($_POST['email'] ?? '')), ['language' => language()]);
    wp_send_json_success();
});
add_action('wp_enqueue_scripts', function () {
    if (!configured() || !is_checkout() || is_order_received_page()) return;
    wp_enqueue_script('mailman-cart', plugins_url('cart.js', __FILE__), [], '0.1.0', true);
    wp_add_inline_script('mailman-cart', 'window.mailmanCart=' . wp_json_encode(['url' => \WC_AJAX::get_endpoint('mailman_cart'), 'nonce' => wp_create_nonce('mailman_cart')]) . ';', 'before');
});
add_action('template_redirect', function () {
    if (!configured() || empty($_GET['mailman_recover']) || !WC()->cart) return;
    $token = sanitize_text_field(wp_unslash($_GET['mailman_recover']));
    if (!preg_match('/^[a-f0-9]{64}$/', $token)) return;
    nocache_headers(); header('Referrer-Policy: no-referrer');
    $saved = get_transient('mailman_recover_' . $token);
    if (!$saved) { wc_add_notice(__('This cart recovery link has expired.', 'mailman'), 'notice'); wp_safe_redirect(wc_get_cart_url()); exit; }
    // Merge into the current cart. WooCommerce revalidates stock, variations and current prices.
    // Existing items remain; opening a recovery link never empties an unrelated cart.
    foreach ($saved['items'] as $line) {
        $key = WC()->cart->generate_cart_id($line['product_id'], $line['variation_id'], $line['variation']);
        if (!WC()->cart->find_product_in_cart($key)) WC()->cart->add_to_cart($line['product_id'], $line['quantity'], $line['variation_id'], $line['variation']);
    }
    capture_recovery_touch($saved, sanitize_text_field(wp_unslash($_GET['mailman_attribution'] ?? '')));
    wp_safe_redirect(wc_get_cart_url()); exit;
});

if (defined('WP_CLI') && WP_CLI) {
    \WP_CLI::add_command('mailman import-orders', function ($args, $assoc) {
        if (!configured()) \WP_CLI::error('Configure MAILMAN_COMMERCE_ENDPOINT and MAILMAN_API_KEY first.');
        $page = max(1, (int) ($assoc['page'] ?? 1));
        $orders = wc_get_orders(['limit' => 100, 'page' => $page, 'orderby' => 'ID', 'order' => 'ASC', 'status' => array_keys(wc_get_order_statuses())]);
        foreach ($orders as $order) { $event = order_event($order, true); if ($event) enqueue($event); }
        \WP_CLI::success('Queued ' . count($orders) . ' historical orders, page ' . $page . '. No order statuses or payments changed.');
    });
    \WP_CLI::add_command('mailman retry-failed', function () {
        global $wpdb;
        $count = $wpdb->update(table(), ['status' => 'pending', 'attempts' => 0, 'next_at' => 0], ['status' => 'failed']);
        do_action('mailman_outbox_sweep'); \WP_CLI::success('Requeued ' . (int) $count . ' events.');
    });
}
