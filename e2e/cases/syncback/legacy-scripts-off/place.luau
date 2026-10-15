local scripts = game:GetService("StarterPlayer").StarterPlayerScripts
scripts.Hud.Source = 'print("hud2")\n'

local fresh = Instance.new("LocalScript")
fresh.Name = "Fresh"
fresh.Source = 'print("fresh")\n'
fresh.Parent = scripts
