local inner = game:GetService("ReplicatedStorage")["$Foo"].Inner
inner.Util.Source = 'return "util2"\n'
local new = Instance.new("ModuleScript")
new.Name = "New"
new.Source = 'return "new"\n'
new.Parent = inner
