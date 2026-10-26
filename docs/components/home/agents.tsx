import { AgentWindows } from "./agent-windows";
import { delay, MoreLink } from "./more-link";

const points = [
	{
		title: "One feature, one folder",
		desc: "When an agent works on a feature, everything it needs is in one folder, from server to client. It spends its context on your task instead of searching the codebase.",
	},
	{
		title: "Several agents at once",
		desc: "Give each agent a feature. A lint rule catches any agent that makes one feature require another, and they never fight over a shared project file.",
	},
];

export function Agents() {
	return (
		<section className="sec" aria-labelledby="ag-h">
			<div className="wrap">
				<div className="cols ag-head">
					<h2 id="ag-h" className="rv">
						Built for agents
					</h2>
					<p className="lede rv" style={delay(80)}>
						Coding agents find their way around a feature folder as
						easily as you do.
					</p>
				</div>
				<AgentWindows />
				<div className="cols ag-pts">
					{points.map((point, i) => (
						<div
							key={point.title}
							className="rv"
							style={delay(i * 80)}
						>
							<h3>{point.title}</h3>
							<p>{point.desc}</p>
						</div>
					))}
				</div>
				<MoreLink href="/docs/v2/agents">Working with agents</MoreLink>
			</div>
		</section>
	);
}
