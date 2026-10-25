"use client";

import { useState } from "react";
import { FaCheck, FaCopy } from "react-icons/fa";

const installs = {
	rokit: {
		label: "Rokit",
		install: "rokit add ldgerrits/rogen",
		init: "rogen init",
	},
	npm: {
		label: "npm",
		install: "npm i @ldgerrits/rogen",
		init: "npx rogen init",
	},
};

type Manager = keyof typeof installs;

export function InstallCommand({ center = false }: { center?: boolean }) {
	const [manager, setManager] = useState<Manager>("rokit");
	const [copied, setCopied] = useState(false);
	const { install, init } = installs[manager];

	const copy = () => {
		navigator.clipboard.writeText(install);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div
			className={`flex flex-col gap-3 ${center ? "items-center" : "items-start"}`}
		>
			<div className="flex gap-1 font-mono text-xs">
				{(Object.keys(installs) as Manager[]).map((id) => (
					<button
						key={id}
						onClick={() => setManager(id)}
						className={`rounded-full px-3 py-1.5 transition-colors duration-300 ${
							manager === id
								? "bg-white/[0.08] text-paper"
								: "text-stone-500 hover:text-paper"
						}`}
					>
						{installs[id].label}
					</button>
				))}
			</div>
			<div className="flex items-center gap-2 rounded-full border border-white/[0.09] bg-ink-card py-1.5 pr-1.5 pl-5 font-mono text-sm text-paper">
				<span className="whitespace-nowrap">
					<span className="select-none text-stone-600">$ </span>
					{install}
				</span>
				<button
					onClick={copy}
					title="Copy to clipboard"
					aria-label="Copy the install command"
					className="grid size-9 shrink-0 place-items-center rounded-full text-stone-500 transition-colors duration-300 hover:bg-white/[0.08] hover:text-paper"
				>
					{copied ? (
						<FaCheck size={12} className="text-brand" />
					) : (
						<FaCopy size={13} />
					)}
				</button>
			</div>
			<p className="text-sm text-stone-500">
				Then run{" "}
				<code className="font-mono text-[0.9em] text-stone-300">
					{init}
				</code>{" "}
				in your project folder.
			</p>
		</div>
	);
}
