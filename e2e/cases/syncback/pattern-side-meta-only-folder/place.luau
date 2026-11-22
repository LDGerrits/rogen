local function at(p) local i=game for part in string.gmatch(p,"[^/]+") do local n=i:FindFirstChild(part) if not n then error("no "..part.." in "..p) end i=n end return i end
local function new(class,parent,name,src) local m=Instance.new(class) m.Name=name if src then m.Source=src end m.Parent=at(parent) return m end
local function mod(parent,name) return new("ModuleScript",parent,name,"return {}\n") end
new("Configuration", "StarterPlayer/StarterPlayerScripts/Shop", "Settings")
