
-- Added by tts/patch.py: the U/G button on gear
function toggle_gear_unit(obj, player_color)
	local notes = parseGMNotes(obj.getGMNotes())
	if notes.gear_unit then
		notes.gear_unit = nil
		notes.might = nil
	else
		notes.gear_unit = true
		notes.might = notes.energy
	end
	obj.setGMNotes(JSON.encode(notes))
	local enc = encoder()
	if enc then enc.rebuildButtons { obj = obj } end
end
