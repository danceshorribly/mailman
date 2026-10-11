import crypto from "node:crypto";

export const RECOVERY_WINDOW_MS = 7 * 86400000;
export const RECOVERY_TOKEN_PATTERN = /^[a-f0-9]{24}\.[A-Za-z0-9_-]{43}$/;
function signature(id) {
	const secret = process.env.SESSION_SECRET;
	if (!secret)
		throw new Error("SESSION_SECRET is required to sign recovery attribution");
	const key = crypto.hkdfSync(
		"sha256",
		secret,
		"",
		"mailman-recovery-attribution-v1",
		32,
	);
	return crypto.createHmac("sha256", key).update(id).digest("base64url");
}
export function createRecoveryToken(messageId) {
	const id = String(messageId);
	if (!/^[a-f0-9]{24}$/.test(id)) throw new Error("Invalid recovery message");
	return `${id}.${signature(id)}`;
}
export function readRecoveryToken(token) {
	if (typeof token !== "string" || !RECOVERY_TOKEN_PATTERN.test(token))
		return null;
	const [id, signed] = token.split(".");
	const expected = Buffer.from(signature(id));
	return crypto.timingSafeEqual(expected, Buffer.from(signed)) ? id : null;
}
export function withRecoveryAttribution(checkoutUrl, messageId) {
	if (!checkoutUrl || !messageId) return checkoutUrl;
	const url = new URL(checkoutUrl);
	url.searchParams.set("mailman_attribution", createRecoveryToken(messageId));
	return url.href;
}
