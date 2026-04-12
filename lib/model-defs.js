// model-defs.js — Single source of truth for model definitions.
//
// Each entry has:
//   value          — primary key, sent to the SDK via setModel()
//   displayName    — shown in the UI
//   description    — shown under the display name
//   aliases        — resolved names the SDK might report back for this model
//   inject         — if true, add this entry when the SDK list is missing it
//   (capability flags inherited from the SDK's "default" entry at runtime)

var MODEL_DEFS = [
  {
    value: "opus",
    displayName: "Opus",
    description: "Most powerful model. Best for complex reasoning and analysis.",
    aliases: ["claude-opus-4-6", "claude-opus-4-6[1m]", "opus[1m]"],
    inject: true,
  },
  {
    value: "claude-opus-4-5-20251101",
    displayName: "Opus 4.5",
    description: "Previous-gen Opus. 200k context.",
    aliases: [],
    inject: true,
  },
];

/**
 * Inject custom model entries into the SDK's model list when missing.
 * Inherits capability flags from the "default" entry if available.
 */
function ensureCustomModels(sdkModels) {
  // Index existing values (lowercase)
  var existing = {};
  var defaultEntry = null;
  for (var i = 0; i < sdkModels.length; i++) {
    var v = (sdkModels[i].value || "").toLowerCase();
    existing[v] = true;
    if (v === "default") defaultEntry = sdkModels[i];
  }

  // Find insertion point: right after "default"
  var insertIdx = 1;
  for (var j = 0; j < sdkModels.length; j++) {
    if ((sdkModels[j].value || "").toLowerCase() === "default") {
      insertIdx = j + 1;
      break;
    }
  }

  var base = defaultEntry || {};
  var toInsert = [];

  for (var k = 0; k < MODEL_DEFS.length; k++) {
    var def = MODEL_DEFS[k];
    if (!def.inject) continue;
    if (existing[def.value.toLowerCase()]) continue;

    toInsert.push({
      value: def.value,
      displayName: def.displayName,
      description: def.description,
      supportsEffort: base.supportsEffort !== undefined ? base.supportsEffort : true,
      supportedEffortLevels: base.supportedEffortLevels || ["low", "medium", "high", "max"],
      supportsAdaptiveThinking: base.supportsAdaptiveThinking !== undefined ? base.supportsAdaptiveThinking : true,
      supportsAutoMode: base.supportsAutoMode !== undefined ? base.supportsAutoMode : true,
    });
  }

  if (toInsert.length === 0) return sdkModels;

  var result = sdkModels.slice();
  result.splice.apply(result, [insertIdx, 0].concat(toInsert));
  return result;
}

/**
 * Check whether reportedModel is just the SDK's resolved form of currentModel.
 * Returns true if they refer to the same model (i.e. don't overwrite).
 */
function resolveModelAlias(currentModel, reportedModel) {
  if (!currentModel || !reportedModel) return false;
  var cur = currentModel.toLowerCase();
  var rep = reportedModel.toLowerCase();
  if (cur === rep) return true;

  for (var i = 0; i < MODEL_DEFS.length; i++) {
    var def = MODEL_DEFS[i];
    if (def.value.toLowerCase() !== cur) continue;
    for (var j = 0; j < def.aliases.length; j++) {
      if (def.aliases[j].toLowerCase() === rep) return true;
    }
    return false;
  }
  return false;
}

module.exports = {
  MODEL_DEFS: MODEL_DEFS,
  ensureCustomModels: ensureCustomModels,
  resolveModelAlias: resolveModelAlias,
};
