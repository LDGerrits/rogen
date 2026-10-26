import { delay, MoreLink } from "./more-link";
import { RouteViews } from "./route-views";
import { RoutingStory } from "./routing-story";

const routes = [
	["Server", "ServerScriptService", "s"],
	["Client", "StarterPlayer/StarterPlayerScripts", "c"],
	["Shared", "ReplicatedStorage/Shared", "r"],
	["*", "ReplicatedStorage/Shared", "r"],
];

function Config() {
	return (
		<>
			<div className="codebox" data-allow-overflow="">
				<div className="fn">
					<span>default.rogen.json</span>
				</div>
				<pre>
					{"{\n  "}
					<span className="k">&quot;name&quot;</span>
					{': "Game",\n  '}
					<span className="k">&quot;routes&quot;</span>
					{": {\n"}
					{routes.map(([key, target, colour], i) => (
						<span key={key}>
							{"    "}
							<span className={`c-${colour}`}>
								&quot;{key}&quot;
							</span>
							{": "}
							<span className={`c-${colour}`}>
								&quot;{target}&quot;
							</span>
							{i < routes.length - 1 ? ",\n" : "\n"}
						</span>
					))}
					{"  },\n  "}
					<span className="k">&quot;tree&quot;</span>
					{": { "}
					<span className="k">&quot;$className&quot;</span>
					{': "DataModel" }\n}'}
				</pre>
			</div>
			<p className="note">
				Add your own, such as{" "}
				<code>&quot;Gui&quot;: &quot;StarterGui&quot;</code>, and{" "}
				<code>@Gui</code> sends a file to StarterGui.
			</p>
		</>
	);
}

export function Routing() {
	return (
		<section className="sec alt" aria-labelledby="route-h">
			<div className="wrap">
				<div className="cols r-head">
					<h2 id="route-h" className="rv">
						How routing works
					</h2>
					<p className="rv" style={delay(80)}>
						You choose the routes and where each one points. Add{" "}
						<code>@Server</code>
						{" to a file's name or put it in a "}
						<code>Server</code> folder, and it goes to
						ServerScriptService. Files without a route go to{" "}
						<code>*</code>.
					</p>
				</div>
			</div>
			<RoutingStory />
			<div className="wrap">
				<RouteViews
					config={<Config />}
					guide={
						<MoreLink href="/docs/v2/core-concepts/routing">
							Read the routing guide
						</MoreLink>
					}
				/>
			</div>
		</section>
	);
}
