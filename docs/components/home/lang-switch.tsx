"use client";

import { useEffect } from "react";
import { setLang, syncLang, useLang, type Lang } from "./lang";

const LABELS: [Lang, string][] = [
	["luau", "Luau"],
	["ts", "roblox-ts"],
];

/** Works with Luau and roblox-ts; picking one rewrites the page's examples in it. */
export function LangSwitch({ className }: { className?: string }) {
	const lang = useLang();
	useEffect(syncLang, []);
	return (
		<div className={`pick langs ${className ?? ""}`}>
			<span id="langs-l">Works with</span>
			<div className="seg" role="radiogroup" aria-labelledby="langs-l">
				{LABELS.map(([id, label]) => (
					<button
						key={id}
						type="button"
						role="radio"
						aria-checked={lang === id}
						data-v={id}
						onClick={() => setLang(id)}
					>
						{label}
					</button>
				))}
			</div>
		</div>
	);
}
