	-- Added by tts/patch.py: a gear can become a unit (Orianna): U gives it Might equal to its Energy, G undoes it
	if parsednotes.energy and type(parsednotes.type) == "string" and parsednotes.type:find("gear") then
		obj.createButton({
			function_owner = self,
			label = parsednotes.gear_unit and "G" or "U",
			position = {-0.8, 0.3, -0.5},
			scale = {0.5, 0.5, 0.5},
			width = 600,
			height = 600,
			color = {0, 0, 0, 1},
			font_color = {250, 180, 0, 1},
			font_size = 500,
			tooltip = parsednotes.gear_unit and "Back to gear" or "Make it a unit (Might = Energy)",
			click_function = "toggle_gear_unit"
		})
	end

