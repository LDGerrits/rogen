local ReplicatedStorage = game:GetService("ReplicatedStorage")

local greeting = require(ReplicatedStorage.shared.greeter.greeting)

print(greeting("server"))
