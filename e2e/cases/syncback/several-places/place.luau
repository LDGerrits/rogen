local quest = Instance.new("Folder")
quest.Name = "Quest"
quest.Parent = game:GetService("ServerScriptService")

local tracker = Instance.new("ModuleScript")
tracker.Name = "Tracker"
tracker.Source = 'return "tracker"\n'
tracker.Parent = quest

local greeter = Instance.new("Folder")
greeter.Name = "Greeter"
greeter.Parent = game:GetService("StarterPlayer").StarterPlayerScripts

local wave = Instance.new("LocalScript")
wave.Name = "Wave"
wave.Source = 'print("wave")\n'
wave.Parent = greeter
