local shared = Instance.new("Folder") shared.Name = "Shared" shared.Parent = game:GetService("ReplicatedStorage")
local shop = Instance.new("Folder") shop.Name = "Shop" shop.Parent = shared
local types = Instance.new("ModuleScript") types.Name = "Types" types.Source = "return {}\n" types.Parent = shop
local scripts = Instance.new("StarterPlayerScripts") scripts.Parent = game:GetService("StarterPlayer")
local ui = Instance.new("Folder") ui.Name = "Shop" ui.Parent = scripts
local hud = Instance.new("LocalScript") hud.Name = "Hud" hud.Source = "print(1)\n" hud.Parent = ui
