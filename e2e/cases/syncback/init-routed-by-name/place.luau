local server = game:GetService("ServerScriptService")

local row = Instance.new("ModuleScript")
row.Name = "Row"
row.Source = "return {}\n"
row.Parent = server.Store

local load = Instance.new("ModuleScript")
load.Name = "Load"
load.Source = "return {}\n"
load.Parent = server.Feat
