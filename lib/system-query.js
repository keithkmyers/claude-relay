// system-query.js — Gateway for all system-initiated (non-user) AI queries.
//
// Every query Clay sends to Claude that wasn't directly typed by the user
// MUST go through this module. It enforces:
//   • Consent — each feature has a setting the user must enable
//   • Isolation — system queries never touch user sessions
//   • Cost tracking — separate ledger from user conversations
//   • Fallbacks — every feature must work without AI
//   • Rate limits — per-feature throttling
//
// Usage:
//   var sq = require("./system-query");
//   sq.init({ getSDK: ..., cwd: ... });
//   sq.register({ id: "session-naming", ... });
//   sq.run("session-naming", { ... });

// --- Feature registry ---
var features = {};

// --- SDK access (set via init()) ---
var _getSDK = null;
var _cwd = null;
var _createMessageQueue = null;

// --- Cost ledger (in-memory, resets on daemon restart) ---
var costLedger = [];

// --- Rate limit tracking ---
var rateLimitWindows = {};   // featureId -> [{ ts: number }]

function init(opts) {
  _getSDK = opts.getSDK;
  _cwd = opts.cwd;
  _createMessageQueue = opts.createMessageQueue;
}

// Register a system query feature.
// Each feature declares its constraints and the module enforces them.
//
// opts = {
//   id: string,                    // unique feature identifier
//   model: string,                 // model to use (e.g. "sonnet")
//   maxTokens: number,             // hard ceiling on response length
//   rateLimit: { max: N, windowMs: N },
//   fallback: function(context),   // REQUIRED: what to do without AI
//   buildPrompt: function(context) -> string,
//   parseResponse: function(text) -> any,
// }
function register(opts) {
  if (!opts.id) throw new Error("system-query: feature must have an id");
  if (typeof opts.fallback !== "function") throw new Error("system-query: feature '" + opts.id + "' must have a fallback");
  if (typeof opts.buildPrompt !== "function") throw new Error("system-query: feature '" + opts.id + "' must have a buildPrompt");
  features[opts.id] = {
    id: opts.id,
    model: opts.model || "sonnet",
    maxTokens: opts.maxTokens || 50,
    rateLimit: opts.rateLimit || { max: 20, windowMs: 3600000 },
    fallback: opts.fallback,
    buildPrompt: opts.buildPrompt,
    parseResponse: opts.parseResponse || function (text) { return text.trim(); },
  };
}

// Check if a feature has exceeded its rate limit.
function isRateLimited(featureId) {
  var feature = features[featureId];
  if (!feature || !feature.rateLimit) return false;
  var now = Date.now();
  var window = rateLimitWindows[featureId] || [];
  // Prune expired entries
  var cutoff = now - feature.rateLimit.windowMs;
  window = window.filter(function (entry) { return entry.ts > cutoff; });
  rateLimitWindows[featureId] = window;
  return window.length >= feature.rateLimit.max;
}

// Record a rate limit event.
function recordRateEvent(featureId) {
  if (!rateLimitWindows[featureId]) rateLimitWindows[featureId] = [];
  rateLimitWindows[featureId].push({ ts: Date.now() });
}

// Record cost for audit trail.
function recordCost(featureId, entry) {
  costLedger.push({
    feature: featureId,
    timestamp: Date.now(),
    model: entry.model || "unknown",
    costUsd: entry.costUsd || 0,
    inputTokens: entry.inputTokens || 0,
    outputTokens: entry.outputTokens || 0,
    result: entry.result || "success",
  });
  // Keep ledger bounded (last 500 entries)
  if (costLedger.length > 500) costLedger = costLedger.slice(-400);
}

// Get cost summary for the current day.
function getDailyCostSummary() {
  var now = Date.now();
  var dayStart = now - (now % 86400000);
  var totalCost = 0;
  var totalQueries = 0;
  var byFeature = {};
  for (var i = 0; i < costLedger.length; i++) {
    var entry = costLedger[i];
    if (entry.timestamp >= dayStart) {
      totalCost += entry.costUsd;
      totalQueries++;
      if (!byFeature[entry.feature]) byFeature[entry.feature] = { cost: 0, count: 0 };
      byFeature[entry.feature].cost += entry.costUsd;
      byFeature[entry.feature].count++;
    }
  }
  return { totalCost: totalCost, totalQueries: totalQueries, byFeature: byFeature };
}

// Run a system query.
//
// featureId: registered feature id
// context: {
//   consent: "off" | "suggest" | "auto",  // caller provides the consent level
//   ...feature-specific data
//   onResult: function(parsedResult, meta)  // meta = { fromAI: bool, consent: string }
//   onError: function(err)                  // optional
// }
function run(featureId, context) {
  var feature = features[featureId];
  if (!feature) {
    console.error("[system-query] Unknown feature:", featureId);
    return;
  }

  var consent = context.consent || "off";

  // Gate 1: Consent
  if (consent === "off") {
    console.log("[system-query] Feature '" + featureId + "' is off, using fallback");
    try {
      var fallbackResult = feature.fallback(context);
      if (context.onResult) context.onResult(fallbackResult, { fromAI: false, consent: consent });
    } catch (e) {
      console.error("[system-query] Fallback error for '" + featureId + "':", e.message);
    }
    return;
  }

  // Gate 2: Rate limit
  if (isRateLimited(featureId)) {
    console.log("[system-query] Feature '" + featureId + "' rate limited, using fallback");
    recordCost(featureId, { result: "rate-limited" });
    try {
      var fallbackResult2 = feature.fallback(context);
      if (context.onResult) context.onResult(fallbackResult2, { fromAI: false, consent: consent });
    } catch (e) {
      console.error("[system-query] Fallback error for '" + featureId + "':", e.message);
    }
    return;
  }

  // Gate 3: SDK available
  if (!_getSDK || !_createMessageQueue) {
    console.error("[system-query] SDK not initialized, using fallback for '" + featureId + "'");
    try {
      var fallbackResult3 = feature.fallback(context);
      if (context.onResult) context.onResult(fallbackResult3, { fromAI: false, consent: consent });
    } catch (e) {}
    return;
  }

  // Build the prompt
  var prompt;
  try {
    prompt = feature.buildPrompt(context);
  } catch (e) {
    console.error("[system-query] buildPrompt error for '" + featureId + "':", e.message);
    try {
      var fallbackResult4 = feature.fallback(context);
      if (context.onResult) context.onResult(fallbackResult4, { fromAI: false, consent: consent });
    } catch (e2) {}
    return;
  }

  // Execute the isolated query
  recordRateEvent(featureId);
  var startTime = Date.now();

  _getSDK().then(function (sdk) {
    var mq = _createMessageQueue();
    var ac = new AbortController();

    // Auto-abort after 15 seconds — system queries should be fast
    var timeout = setTimeout(function () {
      ac.abort();
    }, 15000);

    var queryOpts = {
      cwd: _cwd,
      model: feature.model,
      maxTurns: 1,
      tools: [],                        // NEVER give system queries tools
      abortController: ac,
      settingSources: [],                // CRITICAL: no CLAUDE.md, no project settings — keeps cost minimal
      promptSuggestions: false,          // no suggestions for system queries
      systemPrompt: "You are a concise assistant. Follow the user's instruction exactly. Reply with only what is asked, nothing more.",
    };

    var query;
    try {
      query = sdk.query({
        prompt: mq,
        options: queryOpts,
      });
    } catch (e) {
      clearTimeout(timeout);
      console.error("[system-query] sdk.query() failed for '" + featureId + "':", e.message);
      recordCost(featureId, { model: feature.model, result: "error" });
      try {
        var fb = feature.fallback(context);
        if (context.onResult) context.onResult(fb, { fromAI: false, consent: consent });
      } catch (e2) {}
      return;
    }

    // Push the single message and end the queue
    mq.push({ type: "user", message: { role: "user", content: [{ type: "text", text: prompt }] } });
    mq.end();

    // Consume the response
    var responseText = "";
    var costUsd = 0;
    var inputTokens = 0;
    var outputTokens = 0;

    (async function () {
      try {
        for await (var msg of query) {
          if (msg.type === "assistant") {
            var content = msg.message && msg.message.content;
            if (Array.isArray(content)) {
              for (var i = 0; i < content.length; i++) {
                if (content[i].type === "text") responseText += content[i].text;
              }
            }
          } else if (msg.type === "result") {
            costUsd = msg.total_cost_usd || 0;
            if (msg.usage) {
              inputTokens = msg.usage.input_tokens || 0;
              outputTokens = msg.usage.output_tokens || 0;
            }
          }
        }
      } catch (e) {
        if (e && e.name === "AbortError") {
          console.log("[system-query] Feature '" + featureId + "' timed out, using fallback");
          recordCost(featureId, { model: feature.model, result: "timeout" });
        } else {
          console.error("[system-query] Stream error for '" + featureId + "':", e.message || e);
          recordCost(featureId, { model: feature.model, result: "error" });
        }
        clearTimeout(timeout);
        try {
          var fb2 = feature.fallback(context);
          if (context.onResult) context.onResult(fb2, { fromAI: false, consent: consent });
        } catch (e2) {}
        return;
      }

      clearTimeout(timeout);
      var duration = Date.now() - startTime;

      // Parse the response
      var parsed;
      try {
        parsed = feature.parseResponse(responseText);
      } catch (e) {
        console.error("[system-query] parseResponse error for '" + featureId + "':", e.message);
        recordCost(featureId, { model: feature.model, costUsd: costUsd, inputTokens: inputTokens, outputTokens: outputTokens, result: "parse-error" });
        try {
          var fb3 = feature.fallback(context);
          if (context.onResult) context.onResult(fb3, { fromAI: false, consent: consent });
        } catch (e2) {}
        return;
      }

      // Success
      recordCost(featureId, {
        model: feature.model,
        costUsd: costUsd,
        inputTokens: inputTokens,
        outputTokens: outputTokens,
        result: "success",
      });
      console.log("[system-query] Feature '" + featureId + "' completed in " + duration + "ms" +
        (costUsd ? " ($" + costUsd.toFixed(6) + ")" : "") +
        " raw=" + JSON.stringify(responseText).substring(0, 200) +
        " parsed=" + JSON.stringify(parsed).substring(0, 100));

      if (context.onResult) {
        try {
          console.log("[system-query] calling onResult for '" + featureId + "' with parsed=" + JSON.stringify(parsed));
          context.onResult(parsed, { fromAI: true, consent: consent });
          console.log("[system-query] onResult returned for '" + featureId + "'");
        } catch (e) {
          console.error("[system-query] onResult callback error for '" + featureId + "':", e.message, e.stack);
        }
      } else {
        console.log("[system-query] WARNING: no onResult callback for '" + featureId + "'");
      }
    })();
  }).catch(function (e) {
    console.error("[system-query] SDK load failed for '" + featureId + "':", e.message || e);
    recordCost(featureId, { model: feature.model, result: "sdk-error" });
    try {
      var fb4 = feature.fallback(context);
      if (context.onResult) context.onResult(fb4, { fromAI: false, consent: consent });
    } catch (e2) {}
  });
}

module.exports = {
  init: init,
  register: register,
  run: run,
  getDailyCostSummary: getDailyCostSummary,
};
