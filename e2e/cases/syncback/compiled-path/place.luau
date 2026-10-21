local combat = game:GetService("ServerScriptService").Combat
combat.Combat.Source = 'return "combat2"\n'

local loot = Instance.new("ModuleScript")
loot.Name = "Loot"
loot.Source = 'return "loot"\n'
loot.Parent = combat

combat.Hit:Destroy()
