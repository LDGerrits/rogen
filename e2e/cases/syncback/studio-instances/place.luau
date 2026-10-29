local workspace = game:GetService("Workspace")
Instance.new("Terrain").Parent = workspace
Instance.new("Camera").Parent = workspace

local lighting = game:GetService("Lighting")
Instance.new("Sky").Parent = lighting
Instance.new("Atmosphere").Parent = lighting

Instance.new("StarterCharacterScripts").Parent = game:GetService("StarterPlayer")

local buy = Instance.new("RemoteEvent")
buy.Name = "Buy"
buy.Parent = game:GetService("ReplicatedStorage").Remotes
