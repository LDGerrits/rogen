"use client";

import Link from "next/link";
import { useState } from "react";
import { FaCopy } from "react-icons/fa";

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
		<section className="py-24 px-6">
			<div className="max-w-4xl mx-auto text-center relative flex flex-col items-center">
				<h2 className="text-3xl md:text-5xl font-bold text-white mb-4 tracking-tight">
					Upgrade your codebase
				</h2>
				<p className="text-gray-400 mb-10 tracking-tight text-lg">
					Install it with Rokit or npm, and{" "}
					<code className="text-gray-300">rogen init</code> sets up
					your project.
				</p>

				<div className="w-full flex flex-col md:flex-row items-stretch justify-center gap-4 mb-6">
					{installs.map(({ id, label, lines }) => (
						<div
							key={id}
							className="w-full max-w-md text-left bg-[#0a0a0a] border border-white/10 rounded-lg p-4 shadow-2xl relative group"
						>
							<div className="flex justify-between items-center mb-2">
								<span className="text-xs text-gray-500 font-mono uppercase tracking-wider">
									{label}
								</span>
								<button
									onClick={() =>
										handleCopy(lines.join("\n"), id)
									}
									className="h-8 w-16 flex items-center justify-center text-gray-500 hover:text-white transition-colors -mr-2 rounded-md hover:bg-white/10"
									title="Copy to clipboard"
								>
									{copiedId === id ? (
										<span className="text-xs font-sans text-white leading-none">
											Copied!
										</span>
									) : (
										<FaCopy size={14} />
									)}
								</button>
							</div>
							<pre className="font-mono text-sm text-white leading-7">
								{lines.join("\n")}
							</pre>
						</div>
					))}
				</div>

				<Link
					href="/docs/v2/installation"
					className="text-gray-400 hover:text-white transition-colors text-sm font-medium flex items-center gap-1"
				>
					Read the setup guide <span className="font-serif">→</span>
				</Link>
			</div>
		</section>
	);
}
