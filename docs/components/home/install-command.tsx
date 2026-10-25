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

export function InstallCommand() {
	const [manager, setManager] = useState<Manager>("rokit");
	const [copied, setCopied] = useState(false);
	const { install, init } = installs[manager];

	const copy = () => {
		navigator.clipboard.writeText(install);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div className="inline-flex w-full max-w-[26rem] flex-col gap-3">
			<div className="rounded-[4px] border border-rule bg-ink-raised">
				<div className="flex gap-5 border-b border-rule px-4 text-[13px]">
					{(Object.keys(installs) as Manager[]).map((id) => (
						<button
							key={id}
							onClick={() => setManager(id)}
							className={`-mb-px border-b py-2.5 transition-colors duration-200 ${
								manager === id
									? "border-paper text-paper"
									: "border-transparent text-stone-500 hover:text-stone-300"
							}`}
						>
							{installs[id].label}
						</button>
					))}
				</div>
				<div className="flex items-center justify-between gap-4 py-1.5 pr-1.5 pl-4 font-mono text-sm text-paper">
					<span className="whitespace-nowrap">
						<span className="select-none text-stone-600">$ </span>
						{install}
					</span>
					<button
						onClick={copy}
						title="Copy to clipboard"
						aria-label="Copy the install command"
						className="grid size-9 shrink-0 place-items-center rounded-[3px] text-stone-500 transition-colors duration-200 hover:bg-white/[0.06] hover:text-paper"
					>
						{copied ? (
							<FaCheck size={12} className="text-paper" />
						) : (
							<FaCopy size={13} />
						)}
					</button>
				</div>
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
