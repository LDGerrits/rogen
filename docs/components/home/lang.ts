"use client";

import { useSyncExternalStore } from "react";
import { LANG_KEY, LANG_VALUE, type Lang } from "./lang-script";

export type { Lang };

const EVENT = "rogen:lang";

export const getLang = (): Lang =>
	document.documentElement.dataset.lang === "ts" ? "ts" : "luau";

export function setLang(lang: Lang) {
	if (lang === "ts") document.documentElement.dataset.lang = "ts";
	else delete document.documentElement.dataset.lang;
	try {
		sessionStorage.setItem(LANG_KEY, LANG_VALUE[lang]);
		localStorage.setItem(LANG_KEY, LANG_VALUE[lang]);
	} catch {}
	dispatchEvent(new Event(EVENT));
}

/** Picks up a choice made elsewhere, such as in the docs' tabs before a client-side navigation here. */
export function syncLang() {
	let stored: string | null = null;
	try {
		stored =
			sessionStorage.getItem(LANG_KEY) ?? localStorage.getItem(LANG_KEY);
	} catch {}
	const lang: Lang = stored === LANG_VALUE.ts ? "ts" : "luau";
	if (lang !== getLang()) setLang(lang);
}

export function onLang(listener: () => void) {
	addEventListener(EVENT, listener);
	return () => removeEventListener(EVENT, listener);
}

/** The current language; Luau on the server. */
export const useLang = () =>
	useSyncExternalStore(onLang, getLang, () => "luau" as Lang);
