local combat = game:GetService("ServerScriptService").Combat
combat.Combat.Source = 'return "combat2"\n'

local loot = Instance.new("ModuleScript")
loot.Name = "Loot"
loot.Source = 'return "loot"\n'
loot.Parent = combat

combat.Hit:Destroy()

local workspace = game:GetService("Workspace")
workspace.Baseplate.Transparency = 0.5

local spawn = Instance.new("Part")
spawn.Name = "Spawn"
spawn.Anchored = true
spawn.Parent = workspace
