"use client";

import { useEffect, useRef } from "react";
import { mountStory } from "./story";

/** One file's way from disk to Studio, scrubbed by scroll. */
export function RoutingStory() {
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => mountStory(ref.current!), []);

	return (
		<div ref={ref} className="story">
			<div className="stage">
				<div className="view" />
			</div>
			<ol className="minis" aria-label="One file, step by step" />
		</div>
	);
}
