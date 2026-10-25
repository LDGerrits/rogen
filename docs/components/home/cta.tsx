"use client";

import Link from "next/link";
import { useState } from "react";
import { FaCopy } from "react-icons/fa";
import { Reveal } from "./reveal";

const installs = [
	{
		id: "rokit",
		label: "Rokit",
		lines: ["rokit add ldgerrits/rogen", "rogen init"],
	},
	{
		id: "npm",
		label: "npm",
		lines: ["npm i @ldgerrits/rogen", "npx rogen init"],
	},
];

export function Cta() {
	const [copiedId, setCopiedId] = useState<string | null>(null);

	const handleCopy = (text: string, id: string) => {
		navigator.clipboard.writeText(text);
		setCopiedId(id);
		setTimeout(() => setCopiedId(null), 2000);
	};

	return (
		<section className="relative isolate overflow-hidden border-t border-white/[0.06] px-6 py-28 lg:py-40">
			<div className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[32rem] bg-[radial-gradient(ellipse_50%_60%_at_50%_100%,rgb(240_105_58/0.12),transparent_70%)]" />

			<Reveal className="mx-auto flex max-w-4xl flex-col items-center text-center">
				<h2 className="text-5xl font-semibold leading-[0.95] tracking-[-0.045em] text-paper md:text-7xl">
					Upgrade your codebase
				</h2>
				<p className="mt-6 mb-12 text-lg text-stone-400">
					Install it with Rokit or npm, and{" "}
					<code className="font-mono text-[0.9em] text-stone-200">
						rogen init
					</code>{" "}
					sets up your project.
				</p>

				<div className="mb-10 flex w-full flex-col items-stretch justify-center gap-4 md:flex-row">
					{installs.map(({ id, label, lines }) => (
						<div
							key={id}
							className="surface w-full max-w-md rounded-2xl text-left"
						>
							<div className="flex items-center justify-between border-b border-white/[0.06] py-2 pr-2 pl-5">
								<span className="font-mono text-[11px] uppercase tracking-[0.16em] text-stone-500">
									{label}
								</span>
								<button
									onClick={() =>
										handleCopy(lines.join("\n"), id)
									}
									className="flex h-9 min-w-16 items-center justify-center rounded-full px-3 text-stone-500 transition-colors duration-300 hover:bg-white/[0.06] hover:text-paper"
									title="Copy to clipboard"
								>
									{copiedId === id ? (
										<span className="text-xs font-medium text-paper">
											Copied!
										</span>
									) : (
										<FaCopy size={13} />
									)}
								</button>
							</div>
							<pre className="p-5 font-mono text-sm leading-7 text-paper">
								{lines.map((line) => (
									<div key={line}>
										<span className="select-none text-stone-600">
											${" "}
										</span>
										{line}
									</div>
								))}
							</pre>
						</div>
					))}
				</div>

				<Link
					href="/docs/v2/installation"
					className="group inline-flex items-center gap-1.5 text-sm font-medium text-stone-400 transition-colors duration-300 hover:text-paper"
				>
					Read the setup guide
					<span className="transition-transform duration-500 ease-out-expo group-hover:translate-x-1">
						→
					</span>
				</Link>
			</Reveal>
		</section>
	);
}
