local quest = Instance.new("Folder")
quest.Name = "Quest"
quest.Parent = game:GetService("ServerScriptService")

local tracker = Instance.new("ModuleScript")
tracker.Name = "Tracker"
tracker.Source = 'return "tracker"\n'
tracker.Parent = quest
