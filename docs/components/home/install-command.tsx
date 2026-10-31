"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { TrafficLights } from "../ide";

const installs = {
	rokit: {
		label: "Rokit",
		command: "rokit add ldgerrits/rogen@2.0.0-beta.1",
	},
	npm: { label: "npm", command: "npm i @ldgerrits/rogen@next" },
};

type Manager = keyof typeof installs;
const managers = Object.keys(installs) as Manager[];

function copyText(text: string) {
	if (navigator.clipboard && window.isSecureContext)
		return navigator.clipboard.writeText(text);
	const area = document.createElement("textarea");
	area.value = text;
	area.setAttribute("readonly", "");
	area.style.position = "fixed";
	area.style.opacity = "0";
	document.body.appendChild(area);
	area.select();
	document.execCommand("copy");
	area.remove();
	return Promise.resolve();
}

export function InstallCommand({ className = "" }: { className?: string }) {
	const [manager, setManager] = useState<Manager>("rokit");
	const [shown, setShown] = useState<Manager>("rokit");
	const [copied, setCopied] = useState(false);
	const tabs = useRef<(HTMLButtonElement | null)[]>([]);
	const swapTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

	useEffect(
		() => () => {
			clearTimeout(swapTimer.current);
			clearTimeout(copyTimer.current);
		},
		[]
	);

	const select = (next: Manager) => {
		setManager(next);
		clearTimeout(swapTimer.current);
		if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
			setShown(next);
			return;
		}
		swapTimer.current = setTimeout(() => setShown(next), 150);
	};

	const onKeyDown = (e: KeyboardEvent, i: number) => {
		if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
		const step = e.key === "ArrowRight" ? 1 : managers.length - 1;
		const n = (i + step) % managers.length;
		select(managers[n]);
		tabs.current[n]?.focus();
	};

	const copy = () => {
		const done = () => {
			setCopied(true);
			clearTimeout(copyTimer.current);
			copyTimer.current = setTimeout(() => setCopied(false), 1600);
		};
		copyText(installs[manager].command).then(done, done);
	};

	// A terminal window: the package manager picked in its title bar, the command at its prompt.
	return (
		<div className={`install ide ide-win ide-vs ${className}`}>
			<div className="ide-bar">
				<TrafficLights />
				<div className="seg" role="tablist" aria-label="Install with">
					{managers.map((id, i) => (
						<button
							key={id}
							ref={(el) => {
								tabs.current[i] = el;
							}}
							type="button"
							role="tab"
							aria-selected={manager === id}
							tabIndex={manager === id ? 0 : -1}
							onClick={() => select(id)}
							onKeyDown={(e) => onKeyDown(e, i)}
						>
							{installs[id].label}
						</button>
					))}
				</div>
			</div>
			<div className="cmd">
				<code>
					<i>~ %</i>
					<span className={shown === manager ? "" : "swap"}>
						{installs[shown].command}
					</span>
				</code>
				<button
					type="button"
					className="copy"
					onClick={copy}
					aria-label={copied ? "Copied" : "Copy the command"}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true">
						{copied ? (
							<path d="M3.5 8.5l3 3 6-7" />
						) : (
							<>
								<rect
									x="5.5"
									y="5.5"
									width="8"
									height="8"
									rx="1.5"
								/>
								<path d="M10.5 3.5v-.5a1.5 1.5 0 00-1.5-1.5H4A1.5 1.5 0 002.5 3v5A1.5 1.5 0 004 9.5h.5" />
							</>
						)}
					</svg>
					{copied ? "Copied" : "Copy"}
				</button>
			</div>
		</div>
	);
}
