
-- ---------------------------------------------------------------------------------------------------------------
-- Added by tts/patch.py (https://github.com/raumi-verse/riftbound): on load, download the current card list made
-- from Piltover Archive and merge it over the cards above. New printings are added; the derived notes (might,
-- might_delta, spawn, type, …) replace the hand-written ones field by field; other fields stay. Offline, the cards
-- above are used as they are.
-- ---------------------------------------------------------------------------------------------------------------
local LIVE_URLS = {
  "https://rb.raumi.dev/tts/cards.json",
  "https://raw.githubusercontent.com/raumi-verse/riftbound/main/tts/cards.json",
}

local function mergeLiveCards(data)
  local added = 0
  for slug, card in pairs(data.cards) do
    local entry = cardData[slug]
    local notes = {}
    if entry then
      local ok, old = pcall(JSON.decode, entry.gmNotes or "")
      if ok and type(old) == "table" then notes = old end
    else
      entry = {}
      cardData[slug] = entry
      added = added + 1
    end
    for k, v in pairs(card.notes) do notes[k] = v end
    entry.name = card.name
    entry.description = card.description
    entry.image = card.image
    entry.gmNotes = JSON.encode(notes)
  end
  for id, slug in pairs(data.ids or {}) do tts_to_id_map[id] = slug end
  return added
end

local function fetchLiveCards(i)
  local url = LIVE_URLS[i]
  if not url then
    broadcastToAll("Riftbound cards: couldn't download the current list, using the table's own.", {1, 0.6, 0.2})
    return
  end
  WebRequest.get(url, function(req)
    local ok, data = false, nil
    if not req.is_error and req.text and req.text ~= "" then ok, data = pcall(JSON.decode, req.text) end
    if not ok or type(data) ~= "table" or type(data.cards) ~= "table" then
      fetchLiveCards(i + 1)
      return
    end
    local added = mergeLiveCards(data)
    Global.setVar("Riftbound_NameIndex", nil) -- spawn-by-name rebuilds its index with the new cards
    broadcastToAll("Riftbound cards updated (" .. tostring(data.synced or "?"):sub(1, 10) .. ", " .. added .. " new).",
      {0.6, 1, 0.6})
  end)
end

local onLoadBeforeLiveCards = onLoad
function onLoad(saved_data)
  onLoadBeforeLiveCards(saved_data)
  fetchLiveCards(1)
end
