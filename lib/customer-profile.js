const string = (value, max) =>
	typeof value === "string" ? value.trim().slice(0, max) : undefined;
export function normalizeProfile(input = {}) {
	if (!input || typeof input !== "object" || Array.isArray(input)) return {};
	const profile = {};
	for (const key of ["firstName", "lastName", "fullName"]) {
		const value = string(input[key], 100);
		if (value) profile[key] = value;
	}
	const languageNames = {
		swedish: "sv",
		english: "en",
		german: "de",
		french: "fr",
		spanish: "es",
		finnish: "fi",
		norwegian: "no",
	};
	const countryNames = {
		sweden: "SE",
		sverige: "SE",
		germany: "DE",
		france: "FR",
		spain: "ES",
		finland: "FI",
		norway: "NO",
		denmark: "DK",
		"united kingdom": "GB",
	};
	const rawLanguage = string(input.language, 30)?.toLowerCase();
	const rawCountry = string(input.country, 50)?.toLowerCase();
	const language = Object.hasOwn(languageNames, rawLanguage)
		? languageNames[rawLanguage]
		: rawLanguage;
	const country = Object.hasOwn(countryNames, rawCountry)
		? countryNames[rawCountry]
		: rawCountry?.toUpperCase();
	if (language && /^[a-z]{2,3}(-[a-z]{2})?$/.test(language))
		profile.language = language;
	if (country && /^[A-Z]{2}$/.test(country)) profile.country = country;
	if (Array.isArray(input.tags))
		profile.tags = [
			...new Set(
				input.tags
					.filter((tag) => typeof tag === "string" && tag.trim())
					.map((tag) => tag.trim().slice(0, 80)),
			),
		].slice(0, 50);
	return profile;
}
