local fs = require("@std/fs")
local json = require("@std/json")
local path = require("@std/path")
local query = require("@std/syntax/query")
local syntax = require("@std/syntax")
local utils = require("@std/syntax/utils")

type Side = "server" | "client" | "shared"
type InstancePath = { string }
type Sourcemap = { byFile: { [string]: InstancePath }, instances: { [string]: boolean } }
type Scope = { script: InstancePath, values: { [any]: any }, seen: { [any]: boolean } }

local name = "require_boundaries"

local SIDES: { [string]: Side } = {
	ServerScriptService = "server",
	ServerStorage = "server",
	StarterPlayer = "client",
	StarterGui = "client",
	ReplicatedFirst = "client",
	ReplicatedStorage = "shared",
	Workspace = "shared",
}

local MAY_REQUIRE: { [Side]: { [Side]: boolean } } = {
	server = { server = true, shared = true },
	client = { client = true, shared = true },
	shared = { shared = true },
}

local sourcemaps: { [string]: Sourcemap } = {}

local function loadSourcemap(file: string): Sourcemap
	local absolute = path.format(path.resolve(file))
	if sourcemaps[absolute] then
		return sourcemaps[absolute]
	end
	local result: Sourcemap = { byFile = {}, instances = {} }
	local function walk(node: any, at: InstancePath)
		result.instances[table.concat(at, ".")] = true
		for _, filePath in node.filePaths or {} do
			result.byFile[path.format(path.resolve(path.dirname(absolute), filePath))] = at
		end
		for _, child in node.children or {} do
			local childAt = table.clone(at)
			table.insert(childAt, child.name)
			walk(child, childAt)
		end
	end
	walk(json.deserialize(fs.readFileToString(absolute)), {})
	sourcemaps[absolute] = result
	return result
end

-- The instance path an expression names, or nil when it isn't static.
local function resolve(expr: any, scope: Scope): InstancePath?
	if expr.tag == "group" then
		return resolve(expr.expression, scope)
	elseif expr.tag == "global" then
		if expr.name.text == "game" then
			return {}
		elseif expr.name.text == "script" then
			return table.clone(scope.script)
		end
	elseif expr.tag == "local" then
		local value = scope.values[expr["local"]]
		if value and not scope.seen[value] then
			scope.seen[value] = true
			return resolve(value, scope)
		end
	elseif expr.tag == "indexname" and expr.accessor.text == "." then
		local parent = resolve(expr.expression, scope)
		if parent and expr.index.text == "Parent" then
			return if #parent > 0 then { table.unpack(parent, 1, #parent - 1) } else nil
		elseif parent then
			table.insert(parent, expr.index.text)
			return parent
		end
	elseif expr.tag == "index" and expr.index.tag == "string" then
		local parent = resolve(expr.expression, scope)
		if parent then
			table.insert(parent, expr.index.token.text)
			return parent
		end
	elseif expr.tag == "call" and expr.self then
		local argument = expr.arguments[1]
		local child = argument and argument.node.tag == "string" and argument.node.token.text
		local receiver = child and resolve(expr.func.expression, scope)
		local method = expr.func.index.text
		if receiver and method == "GetService" and #receiver == 0 then
			return { child }
		elseif receiver and (method == "WaitForChild" or method == "FindFirstChild") then
			table.insert(receiver, child)
			return receiver
		end
	end
	return nil
end

-- The side and feature of an instance, where the feature is the child of the deepest feature root.
local function locate(at: InstancePath, featureRoots: { string }): (Side?, string?)
	local joined = table.concat(at, ".")
	local deepest = 0
	for _, root in featureRoots do
		local depth = #string.split(root, ".")
		if depth > deepest and string.sub(joined, 1, #root + 1) == root .. "." then
			deepest = depth
		end
	end
	return SIDES[at[1]], if deepest > 0 then at[deepest + 1] else nil
end

local function lint(ast: syntax.AstStatBlock, sourcepath: path.Path?, context: any)
	local options = context.options
	local sourcemap = loadSourcemap(options.sourcemap or "sourcemap.json")
	local script = sourcepath and sourcemap.byFile[path.format(path.resolve(sourcepath))]
	if script == nil then
		return {}
	end
	local featureRoots = options.featureRoots or {}
	local helpers = {}
	for _, feature in options.sharedFeatures or {} do
		helpers[feature] = true
	end
	local fromSide, fromFeature = locate(script, featureRoots)

	local values = {}
	query.findAllFromRoot(ast, utils.isStatLocal):forEach(function(stat: any)
		if #stat.variables == 1 and #stat.values == 1 then
			values[stat.variables[1].node] = stat.values[1].node
		end
	end)

	local violations = {}
	query.findAllFromRoot(ast, utils.isRequireCall):forEach(function(call: any)
		local argument = call.arguments[1]
		local target = argument and resolve(argument.node, { script = script, values = values, seen = {} })
		if target == nil then
			return
		end
		local targetName = table.concat(target, ".")
		local toSide, toFeature = locate(target, featureRoots)
		local message
		if not sourcemap.instances[targetName] then
			message = `{targetName} is not in the sourcemap`
		elseif fromSide and toSide and not MAY_REQUIRE[fromSide][toSide] then
			message = `{fromSide} code requires {toSide} code: {targetName}`
		elseif fromFeature and toFeature and fromFeature ~= toFeature and not helpers[toFeature] then
			message = `feature {fromFeature} requires feature {toFeature}: {targetName}`
		end
		if message then
			table.insert(violations, {
				lintname = name,
				location = call.location,
				message = message,
				severity = "error",
				sourcepath = sourcepath,
			})
		end
	end)
	return violations
end

return table.freeze({ name = name, lint = lint })
