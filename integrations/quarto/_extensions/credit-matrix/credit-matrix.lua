-- Renders a CRediT statement from Pandoc metadata or Quarto's normalised author roles.
-- Wording follows the by-author statement of the credit-matrix package
-- (src/core/generate-statement.ts), in the document's language.

local stringify = pandoc.utils.stringify

local CREDIT_TERMS = {
  "conceptualization", "data curation", "formal analysis", "funding acquisition",
  "investigation", "methodology", "project administration", "resources", "software",
  "supervision", "validation", "visualization", "writing – original draft",
  "writing – review & editing",
}

-- BEGIN GENERATED TRANSLATIONS
-- From scripts/build-quarto-translations.mjs; do not edit.
local TRANSLATIONS = {
  ["en"] = {
    heading = "CRediT authorship contribution statement",
    roles = {
      ["conceptualization"] = "Conceptualization",
      ["data curation"] = "Data curation",
      ["formal analysis"] = "Formal analysis",
      ["funding acquisition"] = "Funding acquisition",
      ["investigation"] = "Investigation",
      ["methodology"] = "Methodology",
      ["project administration"] = "Project administration",
      ["resources"] = "Resources",
      ["software"] = "Software",
      ["supervision"] = "Supervision",
      ["validation"] = "Validation",
      ["visualization"] = "Visualization",
      ["writing – original draft"] = "Writing – original draft",
      ["writing – review & editing"] = "Writing – review & editing",
    },
    ui = {
      equal = "Equal",
      supporting = "Supporting",
      labelSeparator = ": ",
      nameListSeparator = ", ",
      segmentSeparator = "; ",
      levelAnnotation = "{label} ({level})",
    },
  },
  ["fr"] = {
    heading = "Déclaration CRediT",
    roles = {
      ["conceptualization"] = "Conceptualisation",
      ["data curation"] = "Préparation des données",
      ["formal analysis"] = "Analyse formelle",
      ["funding acquisition"] = "Acquisition de financements",
      ["investigation"] = "Investigation",
      ["methodology"] = "Méthodologie",
      ["project administration"] = "Administration du projet",
      ["resources"] = "Ressources",
      ["software"] = "Logiciel(s)",
      ["supervision"] = "Supervision",
      ["validation"] = "Validation",
      ["visualization"] = "Présentation visuelle",
      ["writing – original draft"] = "Rédaction - ébauche du manuscrit initial",
      ["writing – review & editing"] = "Rédaction - relectures et corrections",
    },
    ui = {
      equal = "Égal",
      supporting = "Secondaire",
      labelSeparator = " : ",
      nameListSeparator = ", ",
      segmentSeparator = " ; ",
      levelAnnotation = "{label} ({level})",
    },
  },
  ["de"] = {
    heading = "CRediT-Erklärung",
    roles = {
      ["conceptualization"] = "Konzeptualisierung",
      ["data curation"] = "Datenpflege",
      ["formal analysis"] = "Formale Analyse",
      ["funding acquisition"] = "Akquise von Finanzmitteln",
      ["investigation"] = "Untersuchung",
      ["methodology"] = "Methodik",
      ["project administration"] = "Projektverwaltung",
      ["resources"] = "Ressourcen",
      ["software"] = "Software",
      ["supervision"] = "Supervision",
      ["validation"] = "Validierung",
      ["visualization"] = "Visualisierung",
      ["writing – original draft"] = "Schreiben – Originalentwurf",
      ["writing – review & editing"] = "Schreiben - Überprüfung und Überarbeitung",
    },
    ui = {
      equal = "Gleichwertig",
      supporting = "Unterstützend",
      labelSeparator = ": ",
      nameListSeparator = ", ",
      segmentSeparator = "; ",
      levelAnnotation = "{label} ({level})",
    },
  },
  ["es"] = {
    heading = "Declaración CRediT",
    roles = {
      ["conceptualization"] = "Conceptualización",
      ["data curation"] = "Curación de datos",
      ["formal analysis"] = "Análisis formal",
      ["funding acquisition"] = "Captación de fondos",
      ["investigation"] = "Investigación",
      ["methodology"] = "Metodología",
      ["project administration"] = "Administración del proyecto",
      ["resources"] = "Recursos",
      ["software"] = "Software",
      ["supervision"] = "Supervisión",
      ["validation"] = "Validación",
      ["visualization"] = "Visualización",
      ["writing – original draft"] = "Redacción - borrador original",
      ["writing – review & editing"] = "Redacción - revisión y edición",
    },
    ui = {
      equal = "Igual",
      supporting = "De apoyo",
      labelSeparator = ": ",
      nameListSeparator = ", ",
      segmentSeparator = "; ",
      levelAnnotation = "{label} ({level})",
    },
  },
  ["it"] = {
    heading = "Dichiarazione CRediT",
    roles = {
      ["conceptualization"] = "Ideazione",
      ["data curation"] = "Cura dei dati",
      ["formal analysis"] = "Analisi formale",
      ["funding acquisition"] = "Acquisizione di fondi",
      ["investigation"] = "Indagine",
      ["methodology"] = "Metodologia",
      ["project administration"] = "Amministrazione di progetto",
      ["resources"] = "Risorse",
      ["software"] = "Programma",
      ["supervision"] = "Supervisore",
      ["validation"] = "Validazione",
      ["visualization"] = "Visualizzazione",
      ["writing – original draft"] = "Redazione - bozza originale",
      ["writing – review & editing"] = "Scrittura - revisione e modifica",
    },
    ui = {
      equal = "Paritario",
      supporting = "Di supporto",
      labelSeparator = ": ",
      nameListSeparator = ", ",
      segmentSeparator = "; ",
      levelAnnotation = "{label} ({level})",
    },
  },
  ["pt-PT"] = {
    heading = "Declaração CRediT",
    roles = {
      ["conceptualization"] = "Conceptualização",
      ["data curation"] = "Curadoria de dados",
      ["formal analysis"] = "Análise formal",
      ["funding acquisition"] = "Obtenção de financiamento",
      ["investigation"] = "Investigação",
      ["methodology"] = "Metodologia",
      ["project administration"] = "Gestão do projeto",
      ["resources"] = "Recursos",
      ["software"] = "Software",
      ["supervision"] = "Supervisão",
      ["validation"] = "Validação",
      ["visualization"] = "Visualização",
      ["writing – original draft"] = "Redação – rascunho original",
      ["writing – review & editing"] = "Redação – revisão e edição",
    },
    ui = {
      equal = "Igual",
      supporting = "De apoio",
      labelSeparator = ": ",
      nameListSeparator = ", ",
      segmentSeparator = "; ",
      levelAnnotation = "{label} ({level})",
    },
  },
  ["nl"] = {
    heading = "CRediT-verklaring",
    roles = {
      ["conceptualization"] = "Conceptualisatie",
      ["data curation"] = "Datacuratie",
      ["formal analysis"] = "Formele analyse",
      ["funding acquisition"] = "Fondsenwerving",
      ["investigation"] = "Onderzoek",
      ["methodology"] = "Methodologie",
      ["project administration"] = "Projectadministratie",
      ["resources"] = "Middelen",
      ["software"] = "Software",
      ["supervision"] = "Supervisie",
      ["validation"] = "Validatie",
      ["visualization"] = "Visualisatie",
      ["writing – original draft"] = "Schrijven – eerste versie",
      ["writing – review & editing"] = "Schrijven – review en bewerking",
    },
    ui = {
      equal = "Gelijk",
      supporting = "Ondersteunend",
      labelSeparator = ": ",
      nameListSeparator = ", ",
      segmentSeparator = "; ",
      levelAnnotation = "{label} ({level})",
    },
  },
  ["zh-Hans"] = {
    heading = "CRediT 声明",
    roles = {
      ["conceptualization"] = "概念化",
      ["data curation"] = "数据管理",
      ["formal analysis"] = "正式分析",
      ["funding acquisition"] = "基金获取",
      ["investigation"] = "做研究",
      ["methodology"] = "方法学",
      ["project administration"] = "项目管理",
      ["resources"] = "资源供给",
      ["software"] = "软件",
      ["supervision"] = "指导",
      ["validation"] = "验证",
      ["visualization"] = "可视化",
      ["writing – original draft"] = "撰写 - 原始草稿",
      ["writing – review & editing"] = "撰写 - 评论和编辑",
    },
    ui = {
      equal = "同等",
      supporting = "辅助",
      labelSeparator = "：",
      nameListSeparator = "、",
      segmentSeparator = "；",
      levelAnnotation = "{label}（{level}）",
    },
  },
  ["ja"] = {
    heading = "CRediT 声明",
    roles = {
      ["conceptualization"] = "研究の立案",
      ["data curation"] = "データ収集・整理",
      ["formal analysis"] = "正式な解析の実施",
      ["funding acquisition"] = "研究資金の調達",
      ["investigation"] = "調査・検証",
      ["methodology"] = "研究方法",
      ["project administration"] = "研究プロジェクトの管理",
      ["resources"] = "研究を行う上で必要な諸要素",
      ["software"] = "研究に使うソフトウェア関連",
      ["supervision"] = "研究の監督",
      ["validation"] = "研究の検証",
      ["visualization"] = "研究の可視化",
      ["writing – original draft"] = "執筆 – 草稿作成",
      ["writing – review & editing"] = "執筆 – レビューおよび校閲",
    },
    ui = {
      equal = "同等",
      supporting = "補助",
      labelSeparator = "：",
      nameListSeparator = "、",
      segmentSeparator = "；",
      levelAnnotation = "{label}（{level}）",
    },
  },
}
-- END GENERATED TRANSLATIONS

-- Match the package's resolveLocaleTag, including its Traditional Chinese fallback.
local function document_locale(value)
  local tag = stringify(value or "en"):gsub("_", "-")
  local language = (tag:match("^[^-]*") or ""):lower()
  if language == "zh" then
    local subtags = "-" .. tag:lower() .. "-"
    if subtags:find("-hans-", 1, true) then return "zh-Hans" end
    for _, subtag in ipairs({ "hant", "tw", "hk", "mo" }) do
      if subtags:find("-" .. subtag .. "-", 1, true) then return "en" end
    end
  end
  if TRANSLATIONS[tag] then return tag end
  if language == "pt" then return "pt-PT" end
  if language == "zh" then return "zh-Hans" end
  return TRANSLATIONS[language] and language or "en"
end

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

local function role_values(author)
  local roles = {}
  local function add(term, degree)
    if not term then return end
    local level = stringify(degree or ""):lower()
    local rank = level == "supporting" and 1 or (level == "equal" and 2 or 3)
    if not roles[term] or rank > roles[term].rank then roles[term] = { rank = rank, level = rank < 3 and level or nil } end
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
  return roles
end

local function role_labels(author, levels, translations)
  local roles = role_values(author)
  local labels = {}
  for _, term in ipairs(CREDIT_TERMS) do
    if roles[term] then
      local label = translations.roles[term]
      local level = levels ~= false and roles[term].level or nil
      if level then
        label = translations.ui.levelAnnotation:gsub("{(%w+)}", function(key)
          return ({ label = label, level = translations.ui[level] })[key]
        end)
      end
      labels[#labels + 1] = label
    end
  end
  return labels
end

local function statement(authors, levels, locale)
  local translations = TRANSLATIONS[locale]
  local inlines = pandoc.List()
  for _, author in ipairs(authors or {}) do
    local labels = role_labels(author, levels, translations)
    if #labels > 0 then
      if #inlines > 0 then inlines:insert(pandoc.Str(translations.ui.segmentSeparator)) end
      inlines:extend({ pandoc.Strong(pandoc.Str(author_name(author))), pandoc.Str(translations.ui.labelSeparator .. table.concat(labels, translations.ui.nameListSeparator)) })
    end
  end
  if #inlines == 0 then return nil end
  inlines:insert(pandoc.Str("."))
  return pandoc.Para(inlines)
end

-- Figure generation shares the CLI renderer with the app and the other document plugins.
local function heatmap(authors, options, locale)
  local command = options.command or { "credit-matrix" }
  if pandoc.utils.type(command) ~= "List" then command = { command } end
  local args = {}
  for i = 2, #command do args[#args + 1] = stringify(command[i]) end
  for _, arg in ipairs({ "convert", "-", "--to", "svg" }) do args[#args + 1] = arg end
  for _, key in ipairs({ "color", "palette", "shape", "size", "font", "font-size", "legend", "legend-position", "marks", "initials", "labels", "skipempty" }) do
    if options[key] ~= nil then
      args[#args + 1] = "--" .. key
      args[#args + 1] = stringify(options[key])
    end
  end
  args[#args + 1] = "--locale"
  args[#args + 1] = options.locale and document_locale(options.locale) or locale
  if options.horizontal == true then args[#args + 1] = "--horizontal" end
  if options.levels == false then args[#args + 1] = "--yes-no" end
  local function quote(value) return '"' .. value:gsub('"', '""') .. '"' end
  local header = { "Name" }
  for _, term in ipairs(CREDIT_TERMS) do header[#header + 1] = quote(term) end
  local rows = { table.concat(header, ",") }
  for _, author in ipairs(authors) do
    local roles = role_values(author)
    local row = { quote(author_name(author)) }
    for _, term in ipairs(CREDIT_TERMS) do
      row[#row + 1] = roles[term] and tostring(({ 33, 66, 100 })[roles[term].rank]) or "0"
    end
    rows[#rows + 1] = table.concat(row, ",")
  end
  local svg = pandoc.pipe(stringify(command[1]), args, table.concat(rows, "\n") .. "\n")
  local name = "credit-heatmap-" .. pandoc.utils.sha1(svg) .. ".svg"
  pandoc.mediabag.insert(name, "image/svg+xml", svg)
  local image_locale = options.locale and document_locale(options.locale) or locale
  return pandoc.Para({ pandoc.Image({ pandoc.Str(stringify(statement(authors, options.levels, image_locale))) }, name) })
end

-- True where the active template prints a plain author but not an author map's name: Pandoc's own
-- HTML, LaTeX, ConTeXt and ms templates print the map as "true". JATS, Markdown and custom templates
-- that read author.name or author.affiliation keep the full map.
local function template_prints_plain_author()
  local template = PANDOC_WRITER_OPTIONS.template
  if not template then return FORMAT == "docx" end
  -- pandoc.template.apply is Pandoc 3; older versions keep the author maps as they are.
  if not pandoc.template.apply then return false end
  local function shows(author)
    local out = pandoc.layout.render(pandoc.template.apply(template, { title = "T", author = { author } }))
    return out:find("CrMxProbe", 1, true) ~= nil
  end
  return FORMAT == "docx" or (shows("CrMxProbe") and not shows({ name = "CrMxProbe" }))
end

function Pandoc(doc)
  local authors = doc.meta.authors or doc.meta.author or {}
  if pandoc.utils.type(authors) ~= "List" then authors = { authors } end
  local locale = document_locale(doc.meta.lang)
  local para = statement(authors, true, locale)
  if not para then return nil end

  -- Pandoc's own templates print an author map as "true", so outside Quarto (which builds its own
  -- title block) each author becomes just the name once the roles are read.
  if not quarto and doc.meta.author and template_prints_plain_author() then
    local list = doc.meta.author
    if pandoc.utils.type(list) ~= "List" then list = pandoc.List({ list }) end
    doc.meta.author = list:map(function(author)
      if pandoc.utils.type(author) == "table" and author.name then return pandoc.Inlines(author_name(author)) end
      return author
    end)
  end

  local options = doc.meta["credit-matrix"] or {}
  local heading = options.heading and stringify(options.heading) or TRANSLATIONS[locale].heading
  local placement = options.placement and stringify(options.placement) or "end"

  local level = 1
  for _, block in ipairs(doc.blocks) do
    if block.t == "Header" then level = block.level break end
  end
  local section = pandoc.List({ pandoc.Header(level, heading, pandoc.Attr("credit-statement", { "unnumbered" })), para })
  if options.heatmap == true then section:insert(heatmap(authors, options, locale)) end

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
