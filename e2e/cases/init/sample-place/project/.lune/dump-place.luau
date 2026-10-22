local fs = require("@lune/fs")
local process = require("@lune/process")
local roblox = require("@lune/roblox")

local db = roblox.getReflectionDatabase()
local game = roblox.deserializePlace(fs.readFile(process.args[1]))

local function propertiesOf(className)
	local names = {}
	local class = db:GetClass(className)
	while class do
		for name, property in class.Properties do
			if not table.find(property.Tags, "NotScriptable") and not table.find(property.Tags, "ReadOnly") and not table.find(property.Tags, "Deprecated") and not table.find(property.Tags, "Hidden") then
				table.insert(names, name)
			end
		end
		class = class.Superclass and db:GetClass(class.Superclass)
	end
	table.sort(names)
	return names
end

local lines = {}
local function visit(instance, path)
	local okDefault, default = pcall(roblox.Instance.new, instance.ClassName)
	table.insert(lines, path .. " (" .. instance.ClassName .. ")")
	for _, name in propertiesOf(instance.ClassName) do
		local ok, value = pcall(function() return instance[name] end)
		local same = okDefault and pcall(function() return default[name] end) and default[name] == value
		if ok and not same and name ~= "Name" and name ~= "Parent" then
			table.insert(lines, "  " .. name .. " = " .. tostring(value))
		end
	end
	local children = instance:GetChildren()
	table.sort(children, function(a, b) return a.Name < b.Name end)
	for _, child in children do
		visit(child, path .. "/" .. child.Name)
	end
end
local services = game:GetChildren()
table.sort(services, function(a, b) return a.Name < b.Name end)
for _, service in services do visit(service, service.Name) end
fs.writeFile(process.args[2], table.concat(lines, "\n") .. "\n")
