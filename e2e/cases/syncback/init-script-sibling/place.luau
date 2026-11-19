local settings = Instance.new("Folder")
settings.Name = "Settings"
settings.Parent = game:GetService("ReplicatedStorage").Shared
local speed = Instance.new("ModuleScript")
speed.Name = "Speed"
speed.Source = "return 16\n"
speed.Parent = settings
