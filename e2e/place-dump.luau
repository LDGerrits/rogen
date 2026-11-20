-- Usage: lune run place-dump.luau <place.rbxl>
-- Prints the instances of the services a project syncs, one line each with the properties syncback writes, sorted, so two places compare as text.
local fs = require("@lune/fs")
local process = require("@lune/process")
local roblox = require("@lune/roblox")
local game = roblox.deserializePlace(fs.readFile(process.args[1]))
local SERVICES = {"ReplicatedStorage","ReplicatedFirst","ServerScriptService","ServerStorage","StarterPlayer","StarterGui","StarterPack","Workspace","Lighting","Teams","SoundService"}
local SKIP = {Camera=true, Terrain=true}
local PROPS = {"Source","Disabled","Enabled","RunContext","Value","Anchored","Size","Color","Transparency","Text"}
local function line(inst, path)
	local parts = {path .. " : " .. inst.ClassName}
	for _, p in PROPS do
		local ok, v = pcall(function() return inst[p] end)
		if ok and v ~= nil then
			local s = tostring(v)
			if p == "Source" then s = string.format("%q", s) end
			table.insert(parts, p .. "=" .. s)
		end
	end
	local attrs = inst:GetAttributes()
	local keys = {}
	for k in attrs do table.insert(keys, k) end
	table.sort(keys)
	for _, k in keys do table.insert(parts, "@" .. k .. "=" .. tostring(attrs[k])) end
	local tags = inst:GetTags()
	table.sort(tags)
	if #tags > 0 then table.insert(parts, "tags=" .. table.concat(tags, ",")) end
	print(table.concat(parts, "  "))
end
local function walk(inst, path)
	line(inst, path)
	local kids = inst:GetChildren()
	table.sort(kids, function(a, b) return a.Name < b.Name or (a.Name == b.Name and a.ClassName < b.ClassName) end)
	for _, c in kids do
		if not SKIP[c.Name] then walk(c, path .. "/" .. c.Name) end
	end
end
for _, name in SERVICES do
	local s = game:FindFirstChildOfClass(name) or game:FindFirstChild(name)
	if s then walk(s, name) end
end
