(function () {
    "use strict";
    const config = window.mailmanCart;
    if (!config) return;
    let timer;
    function send() {
        const allowed = window.KamadoConsent?.allows("advertising") === true;
        // Revocation still reaches the server, which closes any previously captured cart.
        const email = document.querySelector('#billing_email, #email, input[autocomplete="email"], input[type="email"]')?.value || "";
        if (allowed && !email.includes("@")) return;
        const data = new URLSearchParams({ nonce: config.nonce, email: allowed ? email : "" });
        fetch(config.url, { method: "POST", credentials: "same-origin", body: data }).catch(() => {});
    }
    function schedule() { clearTimeout(timer); timer = setTimeout(send, 1200); }
    document.addEventListener("input", (event) => { if (event.target.matches('input[type="email"], #billing_email, input[autocomplete="email"]')) schedule(); });
    window.addEventListener("kamado:consent", schedule);
    if (window.jQuery) window.jQuery(document.body).on("updated_checkout updated_cart_totals", schedule);
    schedule();
})();
