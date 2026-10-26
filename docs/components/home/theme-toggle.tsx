"use client";

import { useTheme } from "fumadocs-ui/provider/base";
import { useSyncExternalStore } from "react";

const noop = () => () => {};

export function ThemeToggle() {
	const { resolvedTheme, setTheme } = useTheme();
	const mounted = useSyncExternalStore(
		noop,
		() => true,
		() => false
	);
	const next = resolvedTheme === "light" ? "dark" : "light";

	return (
		<button
			type="button"
			className="theme"
			aria-label={mounted ? `Switch to ${next} theme` : "Switch theme"}
			onClick={() => setTheme(next)}
		>
			<svg className="sun" viewBox="0 0 24 24" aria-hidden="true">
				<circle cx="12" cy="12" r="4" />
				<path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
			</svg>
			<svg className="moon" viewBox="0 0 24 24" aria-hidden="true">
				<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
			</svg>
		</button>
	);
}
