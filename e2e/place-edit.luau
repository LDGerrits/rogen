-- Usage: lune run place-edit.luau <in.rbxl> <out.rbxl|rbxlx> <edits.luau>
-- Runs the edits with `game` and `Instance` as in Studio's command bar, then saves the place.
local fs = require("@lune/fs")
local luau = require("@lune/luau")
local process = require("@lune/process")
local roblox = require("@lune/roblox")

local input, output, edits = process.args[1], process.args[2], process.args[3]
local game = roblox.deserializePlace(fs.readFile(input))
local environment = setmetatable(
	{ game = game, Instance = roblox.Instance },
	{ __index = _G }
)
luau.load(fs.readFile(edits), { debugName = edits, environment = environment })()
fs.writeFile(output, roblox.serializePlace(game, string.sub(output, -6) == ".rbxlx"))
