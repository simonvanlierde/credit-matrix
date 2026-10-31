-- Renders a CRediT statement from Pandoc metadata or Quarto's normalised author roles.
-- Wording follows the by-author statement of the credit-matrix package
-- (src/core/generate-statement.ts), English only.

local stringify = pandoc.utils.stringify

local CREDIT_TERMS = {
  "conceptualization", "data curation", "formal analysis", "funding acquisition",
  "investigation", "methodology", "project administration", "resources", "software",
  "supervision", "validation", "visualization", "writing – original draft",
  "writing – review & editing",
}

-- Lead and unspecified degrees stay unannotated, as in the app.
local LEVELS = { equal = "Equal", supporting = "Supporting" }

local DEFAULT_HEADING = "CRediT authorship contribution statement"

local ALIASES = {
  writing = "writing – original draft", editing = "writing – review & editing",
  review = "writing – review & editing", analysis = "formal analysis",
  funding = "funding acquisition", admin = "project administration",
  administration = "project administration",
}

local function role_key(value)
  return stringify(value):lower():gsub("&", "and"):gsub("z", "s"):gsub("[^a-z]", "")
end

local function role_term(value)
  local key = role_key(value)
  for _, term in ipairs(CREDIT_TERMS) do
    if role_key(term) == key then return term end
  end
  return ALIASES[stringify(value):lower()]
end

local function author_name(author)
  local name = author.name
  if type(name) == "table" and name.literal then return stringify(name.literal) end
  if type(name) == "table" and (name.given or name.family) then
    return (stringify(name.given or "") .. " " .. stringify(name.family or "")):match("^%s*(.-)%s*$")
  end
  return stringify(name or "")
end

local function role_labels(author)
  local roles = {}
  local function add(term, degree)
    if not term then return end
    local level = stringify(degree or ""):lower()
    local rank = level == "supporting" and 1 or (level == "equal" and 2 or 3)
    if not roles[term] or rank > roles[term].rank then roles[term] = { rank = rank, level = LEVELS[level] } end
  end
  local raw = author.roles or {}
  if pandoc.utils.type(raw) == "Inlines" or type(raw) ~= "table" then raw = { raw } end
  for _, role in ipairs(raw) do
    if type(role) == "table" and role["vocab-term"] then
      add(role_term(role["vocab-term"]), role["degree-of-contribution"])
    elseif pandoc.utils.type(role) == "Inlines" or type(role) == "string" then
      add(role_term(role))
    elseif type(role) == "table" then
      for term, degree in pairs(role) do add(role_term(term), degree) end
    end
  end
  local labels = {}
  for _, term in ipairs(CREDIT_TERMS) do
    if roles[term] then
      local label = term:sub(1, 1):upper() .. term:sub(2)
      local level = roles[term].level
      labels[#labels + 1] = level and (label .. " (" .. level .. ")") or label
    end
  end
  return labels
end

local function statement(authors)
  local inlines = pandoc.List()
  for _, author in ipairs(authors or {}) do
    local labels = role_labels(author)
    if #labels > 0 then
      if #inlines > 0 then inlines:extend({ pandoc.Str(";"), pandoc.Space() }) end
      inlines:extend({ pandoc.Strong(pandoc.Str(author_name(author))), pandoc.Str(": " .. table.concat(labels, ", ")) })
    end
  end
  if #inlines == 0 then return nil end
  inlines:insert(pandoc.Str("."))
  return pandoc.Para(inlines)
end

function Pandoc(doc)
  local authors = doc.meta.authors or doc.meta.author or {}
  if pandoc.utils.type(authors) ~= "List" then authors = { authors } end
  local para = statement(authors)
  if not para then return nil end

  local options = doc.meta["credit-matrix"] or {}
  local heading = options.heading and stringify(options.heading) or DEFAULT_HEADING
  local placement = options.placement and stringify(options.placement) or "end"

  local level = 1
  for _, block in ipairs(doc.blocks) do
    if block.t == "Header" then level = block.level break end
  end
  local section = pandoc.List({ pandoc.Header(level, heading, pandoc.Attr("credit-statement", { "unnumbered" })), para })

  -- A `::: {#credit-statement}` div marks the spot and wins over `placement`.
  local placed = false
  doc.blocks = doc.blocks:walk({
    Div = function(div)
      if div.identifier == "credit-statement" then
        placed = true
        return section
      end
    end,
  })
  if placed then return doc end

  if placement == "start" then
    doc.blocks = section .. doc.blocks
  else
    doc.blocks:extend(section)
  end
  return doc
end
