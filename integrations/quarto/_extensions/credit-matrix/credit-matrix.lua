-- Renders a CRediT statement from the author roles Quarto has already normalised.
-- Quarto runs user filters after its own author normalisation, so each CRediT role
-- carries a lower-case `vocab-term` and an optional `degree-of-contribution`.
-- Wording follows the by-author statement of the credit-matrix package
-- (src/core/generate-statement.ts), English only.

local stringify = pandoc.utils.stringify

local CREDIT_TERMS = {
  "conceptualization", "data curation", "formal analysis", "funding acquisition",
  "investigation", "methodology", "project administration", "resources", "software",
  "supervision", "validation", "visualization", "writing – original draft",
  "writing – review & editing",
}
local ORDER = {}
for i, term in ipairs(CREDIT_TERMS) do ORDER[term] = i end

-- Lead and unspecified degrees stay unannotated, as in the app.
local LEVELS = { equal = "Equal", supporting = "Supporting" }

local DEFAULT_HEADING = "CRediT authorship contribution statement"

local function author_name(author)
  local name = author.name
  if type(name) == "table" and name.literal then return stringify(name.literal) end
  return stringify(name or "")
end

local function role_labels(author)
  local roles = {}
  for _, role in ipairs(author.roles or {}) do
    local term = role["vocab-term"] and stringify(role["vocab-term"])
    if term and ORDER[term] then
      local level = LEVELS[stringify(role["degree-of-contribution"] or ""):lower()]
      local label = term:sub(1, 1):upper() .. term:sub(2)
      roles[#roles + 1] = { order = ORDER[term], label = level and (label .. " (" .. level .. ")") or label }
    end
  end
  table.sort(roles, function(a, b) return a.order < b.order end)
  local labels = {}
  for _, r in ipairs(roles) do labels[#labels + 1] = r.label end
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
  local para = statement(doc.meta.authors)
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
