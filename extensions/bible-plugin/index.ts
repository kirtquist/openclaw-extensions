import { readFile } from 'node:fs/promises';
import { definePluginEntry } from 'openclaw/plugin-sdk/core';

const PLUGIN_ID = 'bible-plugin';
const PLUGIN_NAME = 'Bible Plugin';
const MISSING_OPENROUTER_API_KEY_MESSAGE =
  'Bible plugin needs an OpenRouter API key configured via plugin config field openrouterApiKey or OPENROUTER_API_KEY.';
const GENERIC_REQUEST_FAILURE_MESSAGE =
  'Bible plugin could not complete that request right now. Please try again in a moment.';
const DEFAULTS = {
  provider: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
  model: 'google/gemini-2.5-flash',
  reasoningEffort: 'none',
  requestTimeoutMs: 45000,
  signalMaxChars: 1400,
  defaultMode: 'study'
} as const;

const DEFAULT_FAILOVER = {
  provider: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
  model: 'google/gemini-3-flash-preview',
  reasoningEffort: 'none',
  requestTimeoutMs: 120000
} as const;

const FAILOVER_NOTE = '\n\n(Used OpenRouter fallback — local Ollama was unavailable.)';

const BIBLE_MODES = ['short', 'study', 'leader', 'enhanced-study'] as const;

type BibleMode = (typeof BIBLE_MODES)[number];
type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'max';
type Provider = 'openrouter' | 'ollama';

type RequestEndpointConfig = {
  provider: Provider;
  baseUrl: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  requestTimeoutMs: number;
  openrouterApiKey?: string;
};

type ModeOverrideConfig = Partial<RequestEndpointConfig> & {
  failover?: boolean | Partial<RequestEndpointConfig>;
};

export type BiblePluginConfig = RequestEndpointConfig & {
  signalMaxChars: number;
  defaultMode: BibleMode;
  failover?: Partial<RequestEndpointConfig>;
  modes?: Partial<Record<BibleMode, ModeOverrideConfig>>;
};

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return value === 'none' || value === 'low' || value === 'medium' || value === 'high' || value === 'max';
}

function isBibleMode(value: unknown): value is BibleMode {
  return typeof value === 'string' && (BIBLE_MODES as readonly string[]).includes(value);
}

function parseRequestTimeoutMs(value: unknown, fallback: number) {
  return Number.isInteger(value) && (value as number) >= 1000 && (value as number) <= 900000
    ? (value as number)
    : fallback;
}

function parseEndpointPartial(
  raw: Record<string, unknown>,
  fallback: RequestEndpointConfig
): RequestEndpointConfig {
  return {
    provider:
      raw.provider === 'ollama' ? 'ollama' : raw.provider === 'openrouter' ? 'openrouter' : fallback.provider,
    baseUrl:
      typeof raw.baseUrl === 'string' && raw.baseUrl.trim() ? raw.baseUrl.trim() : fallback.baseUrl,
    model: typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : fallback.model,
    reasoningEffort: isReasoningEffort(raw.reasoningEffort) ? raw.reasoningEffort : fallback.reasoningEffort,
    requestTimeoutMs: parseRequestTimeoutMs(raw.requestTimeoutMs, fallback.requestTimeoutMs),
    openrouterApiKey:
      typeof raw.openrouterApiKey === 'string' && raw.openrouterApiKey.trim()
        ? raw.openrouterApiKey.trim()
        : fallback.openrouterApiKey
  };
}

function parseModeEndpointOverride(raw: Record<string, unknown>): Partial<RequestEndpointConfig> {
  const override: Partial<RequestEndpointConfig> = {};
  if (raw.provider === 'ollama' || raw.provider === 'openrouter') {
    override.provider = raw.provider;
  }
  if (typeof raw.baseUrl === 'string' && raw.baseUrl.trim()) {
    override.baseUrl = raw.baseUrl.trim();
  }
  if (typeof raw.model === 'string' && raw.model.trim()) {
    override.model = raw.model.trim();
  }
  if (isReasoningEffort(raw.reasoningEffort)) {
    override.reasoningEffort = raw.reasoningEffort;
  }
  if (Number.isInteger(raw.requestTimeoutMs)) {
    override.requestTimeoutMs = parseRequestTimeoutMs(raw.requestTimeoutMs, DEFAULTS.requestTimeoutMs);
  }
  if (typeof raw.openrouterApiKey === 'string' && raw.openrouterApiKey.trim()) {
    override.openrouterApiKey = raw.openrouterApiKey.trim();
  }
  return override;
}

function parseModeOverrides(raw: unknown): Partial<Record<BibleMode, ModeOverrideConfig>> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }

  const modes: Partial<Record<BibleMode, ModeOverrideConfig>> = {};
  for (const mode of BIBLE_MODES) {
    const entry = (raw as Record<string, unknown>)[mode];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const override: ModeOverrideConfig = parseModeEndpointOverride(record);
    if (record.failover === true || record.failover === false) {
      override.failover = record.failover;
    } else if (record.failover && typeof record.failover === 'object' && !Array.isArray(record.failover)) {
      override.failover = parseModeEndpointOverride(record.failover as Record<string, unknown>);
    }
    if (Object.keys(override).length > 0) {
      modes[mode] = override;
    }
  }

  return Object.keys(modes).length > 0 ? modes : undefined;
}

function getPluginConfig(fullConfig: any): BiblePluginConfig {
  const entry = fullConfig?.plugins?.entries?.[PLUGIN_ID];
  const raw = entry?.config ?? entry ?? {};
  const baseFallback: RequestEndpointConfig = {
    provider: DEFAULTS.provider,
    baseUrl: DEFAULTS.baseUrl,
    model: DEFAULTS.model,
    reasoningEffort: DEFAULTS.reasoningEffort,
    requestTimeoutMs: DEFAULTS.requestTimeoutMs,
    openrouterApiKey: undefined
  };
  const endpoint = parseEndpointPartial(raw, baseFallback);
  if (typeof raw.openrouterApiKey === 'string' && raw.openrouterApiKey.trim()) {
    endpoint.openrouterApiKey = raw.openrouterApiKey.trim();
  }

  let failover: Partial<RequestEndpointConfig> | undefined;
  if (raw.failover && typeof raw.failover === 'object' && !Array.isArray(raw.failover)) {
    failover = parseModeEndpointOverride(raw.failover as Record<string, unknown>);
  }

  return {
    ...endpoint,
    signalMaxChars: Number.isInteger(raw.signalMaxChars) ? raw.signalMaxChars : DEFAULTS.signalMaxChars,
    defaultMode: isBibleMode(raw.defaultMode) ? raw.defaultMode : DEFAULTS.defaultMode,
    failover,
    modes: parseModeOverrides(raw.modes)
  };
}

function toRequestEndpoint(config: BiblePluginConfig): RequestEndpointConfig {
  return {
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
    reasoningEffort: config.reasoningEffort,
    requestTimeoutMs: config.requestTimeoutMs,
    openrouterApiKey: config.openrouterApiKey
  };
}

export function resolveRequestConfig(config: BiblePluginConfig, mode: BibleMode): RequestEndpointConfig {
  const base = toRequestEndpoint(config);
  const override = config.modes?.[mode];
  if (!override) {
    return base;
  }
  const { failover: _failover, ...endpointOverride } = override;
  return parseEndpointPartial(endpointOverride as Record<string, unknown>, base);
}

export function resolveFailoverEndpoint(
  config: BiblePluginConfig,
  mode: BibleMode
): RequestEndpointConfig | undefined {
  const setting = config.modes?.[mode]?.failover;
  if (setting === false || setting === undefined) {
    return undefined;
  }

  const fallback: RequestEndpointConfig = {
    provider: DEFAULT_FAILOVER.provider,
    baseUrl: DEFAULT_FAILOVER.baseUrl,
    model: DEFAULT_FAILOVER.model,
    reasoningEffort: DEFAULT_FAILOVER.reasoningEffort,
    requestTimeoutMs: DEFAULT_FAILOVER.requestTimeoutMs,
    openrouterApiKey: config.openrouterApiKey
  };

  let partial: Partial<RequestEndpointConfig> | undefined;
  if (setting === true) {
    if (!config.failover || Object.keys(config.failover).length === 0) {
      partial = {};
    } else {
      partial = config.failover;
    }
  } else {
    partial = { ...config.failover, ...setting };
  }

  return parseEndpointPartial(partial as Record<string, unknown>, fallback);
}

function normalizeModeToken(token: string) {
  return token
    .normalize('NFKC')
    .replace(/[‐‑‒–—―]/g, '-') // normalize unicode dashes to ASCII '-'
    .toLowerCase();
}

function parseCommandArgs(args: string | undefined, defaultMode: BibleMode) {
  const trimmed = (args ?? '').trim();
  if (!trimmed) {
    return { mode: defaultMode, reference: '' };
  }

  const tokens = trimmed.split(/\s+/);
  let mode = defaultMode;
  const remainder: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const normalized = normalizeModeToken(token);

    if (normalized === '--mode' && i + 1 < tokens.length) {
      const next = normalizeModeToken(tokens[i + 1]);
      if (next === 'study') {
        mode = 'study';
        i++;
        continue;
      }
      if (next === 'short') {
        mode = 'short';
        i++;
        continue;
      }
      if (next === 'leader') {
        mode = 'leader';
        i++;
        continue;
      }
      if (next === 'enhanced-study'|| next === 'es' || next === 'enhanced') {
        mode = 'enhanced-study';
        i++;
        continue;
      }
      // Ignore invalid --mode values rather than polluting the reference.
      i++;
      continue;
    }

    if (normalized === '--mode') {
      // Ignore dangling --mode with no value.
      continue;
    }

    if (normalized.startsWith('--mode=')) {
      const value = normalized.slice('--mode='.length);
      if (value === 'study') {
        mode = 'study';
        continue;
      }
      if (value === 'short') {
        mode = 'short';
        continue;
      }
      if (value === 'leader') {
        mode = 'leader';
        continue;
      }
      if (value === 'enhanced-study' || value === 'enhanced' || value === 'es') {
        mode = 'enhanced-study';
        continue;
      }      
      // Ignore invalid --mode=VALUE rather than polluting the reference.
      continue;
    }

    if (normalized === '--study' || normalized === '-s' || normalized === 'study') {
      mode = 'study';
      continue;
    }
    if (normalized === '--short' || normalized === '-d' || normalized === 'short') {
      mode = 'short';
      continue;
    }
    if (normalized === '--leader' || normalized === '-l' || normalized === 'leader') {
      mode = 'leader';
      continue;
    }
    if (
      normalized === '--enhanced' ||
      normalized === '--enhanced-study' ||
      normalized === '--es' ||
      normalized === 'es' ||
      normalized === 'enhanced' ||
      normalized === 'enhanced-study'
    ) {
      mode = 'enhanced-study';
      continue;
    }
    remainder.push(token);
  }

  return { mode, reference: remainder.join(' ').trim() };
}

function usageText() {
  return [
    'Usage:',
    '/bible matthew 25',
    '/bible --study matthew 25',
    '/bible --leader matthew 25',
    '/bible --enhanced-study matthew 25',
    '/bible study matthew 25',
    '/bible --es matthew 25',
    '/bible --mode=enhanced-study matthew 25',    
  ].join('\n');
}

async function loadPromptTemplate(mode: BibleMode) {
  const filename =
    mode === 'study' ? './prompts/study.md' :
    mode === 'leader' ? './prompts/leader.md' :
    mode === 'enhanced-study' ? './prompts/enhanced-study.md' :
    './prompts/short.md';
  const url = new URL(filename, import.meta.url);
  return (await readFile(url, 'utf8')).trim() + '\n';
}

function fillPrompt(template: string, reference: string) {
  return template.replaceAll('{reference}', reference);
}

function normalizeFields(data: Record<string, unknown>) {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const cleanKey = key.trim().toLowerCase().replace(/[-\s]+/g, '_');
    normalized[cleanKey] = value;
  }
  return normalized;
}

function extractJsonContent(content: unknown) {
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    return content as Record<string, unknown>;
  }

  let text = String(content ?? '').trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) {
    text = fenced[1].trim();
  }

  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error('Model response did not contain parseable JSON');
  }
}

function cleanText(value: unknown) {
  if (!value) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function normalizeStudyKeyPoints(generated: Record<string, unknown>) {
  const candidate = generated.key_points ?? generated.keypoints;

  if (Array.isArray(candidate)) {
    return candidate.map((item) => cleanText(item)).filter(Boolean).slice(0, 3);
  }

  if (typeof candidate !== 'string') {
    return [];
  }

  const text = candidate.trim();
  if (!text) {
    return [];
  }

  const stripMarker = (line: string) =>
    line
      .replace(/^[-*•]\s+/, '')
      .replace(/^\d+[\).]\s+/, '')
      .trim();

  let points = text
    .split(/\n+/)
    .map((line) => stripMarker(line))
    .filter(Boolean);

  // Fallback for single-line bullet/numbered output.
  if (points.length <= 1) {
    const inlinePoints = text
      .split(/(?:^|\s+)(?:[-*•]|\d+[\).])\s+/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (inlinePoints.length > 1) {
      points = inlinePoints;
    }
  }

  return points.slice(0, 3);
}

function firstSentences(value: unknown, count: number) {
  const cleaned = cleanText(value);
  if (!cleaned) return '';
  const parts = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
  return parts.slice(0, count).join(' ').trim();
}

function trimText(text: string, limit: number) {
  if (text.length <= limit) return text;
  let truncated = text.slice(0, limit - 3);
  const cut = truncated.lastIndexOf(' ');
  if (cut > 0) {
    truncated = truncated.slice(0, cut);
  }
  return truncated + '...';
}

function renderShortReply(generated: Record<string, unknown>, reference: string, signalMaxChars: number) {
  const parts = [
    cleanText(generated.reference) || reference,
    firstSentences(generated.summary, 2),
    firstSentences(generated.historical_context ?? generated.historicalcontext, 1)
      ? `Historical context: ${firstSentences(generated.historical_context ?? generated.historicalcontext, 1)}`
      : '',
    firstSentences(generated.application, 2)
      ? `Apply it: ${firstSentences(generated.application, 2)}`
      : '',
    firstSentences(generated.prayer, 1)
      ? `Prayer: ${firstSentences(generated.prayer, 1)}`
      : ''
  ].filter(Boolean);

  return trimText(parts.join(' '), signalMaxChars);
}

function renderStudyReply(generated: Record<string, unknown>, reference: string) {
  const keyPoints = normalizeStudyKeyPoints(generated).map((item) => `- ${item}`);
  const discussionQuestions = normalizeStringArray(generated.discussion_questions ?? generated.discussionquestions)
    .map((item, index) => `${index + 1}. ${item}`);

  const sections = [
    cleanText(generated.title) || reference,
    `Reference: ${cleanText(generated.reference) || reference}`,
    cleanText(generated.big_idea) ? `Big idea: ${cleanText(generated.big_idea)}` : '',
    cleanText(generated.book_context ?? generated.bookcontext)
      ? `Book context: ${cleanText(generated.book_context ?? generated.bookcontext)}`
      : '',
    cleanText(generated.historical_context ?? generated.historicalcontext)
      ? `Historical context: ${cleanText(generated.historical_context ?? generated.historicalcontext)}`
      : '',
    keyPoints.length ? `Key points:\n${keyPoints.join('\n')}` : '',
    discussionQuestions.length ? `Discussion questions:\n${discussionQuestions.join('\n')}` : '',
    cleanText(generated.action_step ?? generated.actionstep)
      ? `Action step: ${cleanText(generated.action_step ?? generated.actionstep)}`
      : '',
    cleanText(generated.application) ? `Application: ${cleanText(generated.application)}` : '',
    cleanText(generated.prayer) ? `Prayer: ${cleanText(generated.prayer)}` : ''
  ].filter(Boolean);

  return sections.join('\n\n');
}

function renderLeaderReply(generated: Record<string, unknown>, reference: string) {
  const study = renderStudyReply(generated, reference);
  const suggestedAnswers = normalizeStringArray(generated.suggested_answers ?? generated.suggestedanswers)
    .map((item, index) => `${index + 1}. ${item}`);
  const followUpPrompts = normalizeStringArray(generated.follow_up_prompts ?? generated.followupprompts)
    .map((item) => `- ${item}`);
  const facilitatorNotes = normalizeStringArray(generated.facilitator_notes ?? generated.facilitatornotes)
    .map((item) => `- ${item}`);

  return [
    study,
    suggestedAnswers.length ? `Suggested responses:\n${suggestedAnswers.join('\n')}` : '',
    followUpPrompts.length ? `Follow-up prompts:\n${followUpPrompts.join('\n')}` : '',
    facilitatorNotes.length ? `Facilitator notes:\n${facilitatorNotes.join('\n')}` : '',
    cleanText(generated.closing_challenge ?? generated.closingchallenge)
      ? `Closing challenge: ${cleanText(generated.closing_challenge ?? generated.closingchallenge)}`
      : ''
  ].filter(Boolean).join('\n\n');
}

function normalizeStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => cleanText(item)).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/\n+/)
      .map((item) => item.replace(/^[-*•]\s+/, '').trim())
      .filter(Boolean);
  }
  return [];
}

function renderEnhancedStudyReply(generated: Record<string, unknown>, reference: string) {
  const passageStructure = normalizeStringArray(generated.passage_structure ?? generated.passagestructure)
    .map((item) => `- ${item}`);
  const explicitTeaching = normalizeStringArray(generated.explicit_teaching).map((item) => `- ${item}`);
  const supportedInferences = normalizeStringArray(generated.supported_inferences).map((item) => `- ${item}`);
  const keyPoints = normalizeStringArray(generated.key_points ?? generated.keypoints).map((item) => `- ${item}`);

  const sections = [
    cleanText(generated.title) || reference,
    `Reference: ${cleanText(generated.reference) || reference}`,
    cleanText(generated.big_idea) ? `Big idea: ${cleanText(generated.big_idea)}` : '',
    cleanText(generated.book_context ?? generated.bookcontext)
      ? `Book context: ${cleanText(generated.book_context ?? generated.bookcontext)}`
      : '',
    cleanText(generated.historical_context ?? generated.historicalcontext)
      ? `Historical context: ${cleanText(generated.historical_context ?? generated.historicalcontext)}`
      : '',
    passageStructure.length ? `Passage structure:\n${passageStructure.join('\n')}` : '',
    explicitTeaching.length ? `Explicit teaching:\n${explicitTeaching.join('\n')}` : '',
    supportedInferences.length ? `Supported inferences:\n${supportedInferences.join('\n')}` : '',
    keyPoints.length ? `Key points:\n${keyPoints.join('\n')}` : '',
    cleanText(generated.application) ? `Application: ${cleanText(generated.application)}` : '',
    cleanText(generated.prayer) ? `Prayer: ${cleanText(generated.prayer)}` : ''
  ].filter(Boolean);

  return sections.join('\n\n');
}

function truncateForDisplay(text: string, maxChars: number) {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxChars) {
    return cleaned;
  }
  return `${cleaned.slice(0, maxChars - 3)}...`;
}

function extractApiErrorDetail(body: string) {
  const trimmed = body.trim();
  if (!trimmed) {
    return '';
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const err = parsed.error;
    if (err && typeof err === 'object' && !Array.isArray(err)) {
      const message = (err as Record<string, unknown>).message;
      if (typeof message === 'string' && message.trim()) {
        return message.trim();
      }
    }
    if (typeof parsed.message === 'string' && parsed.message.trim()) {
      return parsed.message.trim();
    }
  } catch {
    // use raw body fallback below
  }

  return truncateForDisplay(trimmed, 240);
}

function hintForHttpStatus(status: number) {
  if (status === 401) {
    return 'Check that your OpenRouter API key is valid (openrouterApiKey or OPENROUTER_API_KEY).';
  }
  if (status === 402) {
    return 'OpenRouter reported a billing or credits issue; add credits or check your account limits.';
  }
  if (status === 429) {
    return 'OpenRouter rate limit or quota was exceeded; wait a moment or review usage on openrouter.ai.';
  }
  if (status === 503 || status === 529) {
    return 'The model provider may be overloaded; try again shortly or switch models in plugin config.';
  }
  if (status >= 500) {
    return 'The model API returned a server error; try again in a moment.';
  }
  if (status === 400) {
    return 'The request was rejected by the model API; check plugin model settings.';
  }
  return '';
}

const MODEL_API_ERROR_RE = /^Model API error \((\d{3})\):\s*([\s\S]*)$/;

export function isFailoverEligibleError(error: unknown, primaryProvider: Provider) {
  if (primaryProvider !== 'ollama') {
    return false;
  }

  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const name = error instanceof Error ? error.name : '';

  if (message === 'Model response did not contain parseable JSON') {
    return false;
  }

  const modelMatch = message.match(MODEL_API_ERROR_RE);
  if (modelMatch) {
    const status = Number(modelMatch[1]);
    return status === 502 || status === 503 || status === 504;
  }

  if (
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    /timed?\s*out/i.test(message) ||
    message.includes('The operation was aborted')
  ) {
    return true;
  }

  return (
    /fetch failed|ECONNREFUSED|ENOTFOUND|ECONNRESET|network/i.test(message) ||
    message.includes('Failed to fetch')
  );
}

function formatUserFacingError(error: unknown) {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const name = error instanceof Error ? error.name : '';

  if (!message) {
    return GENERIC_REQUEST_FAILURE_MESSAGE;
  }

  if (message === MISSING_OPENROUTER_API_KEY_MESSAGE) {
    return MISSING_OPENROUTER_API_KEY_MESSAGE;
  }

  const modelMatch = message.match(MODEL_API_ERROR_RE);
  if (modelMatch) {
    const status = Number(modelMatch[1]);
    const detail = extractApiErrorDetail(modelMatch[2] ?? '');
    const hint = hintForHttpStatus(status);
    const parts = [`Bible plugin: model API returned HTTP ${status}.`];
    if (detail) {
      parts.push(detail);
    }
    if (hint) {
      parts.push(hint);
    }
    return truncateForDisplay(parts.join(' '), 900);
  }

  if (message === 'Model response did not contain parseable JSON') {
    return 'Bible plugin: the model returned a reply that was not valid JSON. Try again or switch to a more reliable model in plugin config.';
  }

  if (
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    /timed?\s*out/i.test(message) ||
    message.includes('The operation was aborted')
  ) {
    return 'Bible plugin: the model request timed out. Try again, use a shorter reference, or increase requestTimeoutMs in plugin config.';
  }

  if (
    /fetch failed|ECONNREFUSED|ENOTFOUND|ECONNRESET|network/i.test(message) ||
    message.includes('Failed to fetch')
  ) {
    return 'Bible plugin: could not reach the model API. Check network connectivity and baseUrl in plugin config.';
  }

  if (message.startsWith('Bible plugin:')) {
    return truncateForDisplay(message, 900);
  }

  return truncateForDisplay(`${GENERIC_REQUEST_FAILURE_MESSAGE} Detail: ${message}`, 900);
}

function resolveOpenRouterApiKey(config: RequestEndpointConfig) {
  if (config.openrouterApiKey) {
    return config.openrouterApiKey;
  }

  const envKey = process.env.OPENROUTER_API_KEY?.trim();
  if (envKey) {
    return envKey;
  }

  throw new Error(MISSING_OPENROUTER_API_KEY_MESSAGE);
}

async function generateSummary(config: RequestEndpointConfig, mode: BibleMode, reference: string) {
  const promptTemplate = await loadPromptTemplate(mode);
  const prompt = fillPrompt(promptTemplate, reference);
  const apiKey = config.provider === 'openrouter'
    ? resolveOpenRouterApiKey(config)
    : undefined;
  const payload: Record<string, unknown> = {
    model: config.model,
    temperature:
    mode === 'enhanced-study' ? 0.45 :
    mode === 'leader' ? 0.45 :
    mode === 'study' ? 0.5 :
    0.4,
  
    max_tokens:
      mode === 'enhanced-study' ? 3200 :
      mode === 'leader' ? 2600 :
      mode === 'study' ? 1500 :
      700,
    messages: [
        {
        role: 'system',
        content: 'You are a careful Christ-centered Christian study assistant that returns valid JSON only. You are a Bible first ministry. You are a Bible first disciple. You are a Bible first follower of Jesus Christ. You are a Bible first believer in Jesus Christ. You are a Bible first Christian.'
      },
      {
        role: 'user',
        content: prompt
      }
    ]
  };

  if (config.provider === 'ollama') {
    payload.reasoning_effort = config.reasoningEffort;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
    headers['HTTP-Referer'] = 'https://openclaw.local';
    headers['X-Title'] = 'OpenClaw Bible Plugin';
  }

  const response = await fetch(config.baseUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(config.requestTimeoutMs)
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Model API error (${response.status}): ${body}`);
  }

  const data = await response.json();
  let content = data?.choices?.[0]?.message?.content;
  if (Array.isArray(content)) {
    content = content
      .map((part) => (part && typeof part === 'object' ? part.text ?? '' : ''))
      .join('');
  }

  return normalizeFields(extractJsonContent(content));
}

async function generateSummaryWithOptionalFailover(
  pluginConfig: BiblePluginConfig,
  mode: BibleMode,
  reference: string
) {
  const primary = resolveRequestConfig(pluginConfig, mode);
  const failoverEndpoint = resolveFailoverEndpoint(pluginConfig, mode);

  try {
    const generated = await generateSummary(primary, mode, reference);
    return { generated, usedFailover: false };
  } catch (primaryError) {
    if (!failoverEndpoint || !isFailoverEligibleError(primaryError, primary.provider)) {
      throw primaryError;
    }

    console.error(
      '[bible-plugin] primary request failed, attempting failover:',
      primaryError instanceof Error ? primaryError.message : primaryError
    );
    console.error(
      `[bible-plugin] mode=${mode} failover=${failoverEndpoint.provider}/${failoverEndpoint.model}`
    );

    const generated = await generateSummary(failoverEndpoint, mode, reference);
    return { generated, usedFailover: true };
  }
}

const plugin = definePluginEntry({
  id: PLUGIN_ID,
  name: PLUGIN_NAME,
  description: 'OpenClaw-native /bible slash command for devotional and study summaries.',
  register(api: any) {
    api.registerCommand({
      name: 'bible',
      description: 'Summarize a Bible chapter in short, study, leader, or enhanced-study mode.',
      acceptsArgs: true,
      handler: async (ctx: any) => {
        const pluginConfig = getPluginConfig(ctx.config);
        const { mode, reference } = parseCommandArgs(ctx.args, pluginConfig.defaultMode as BibleMode);

        if (!reference) {
          return { text: usageText() };
        }

        try {
          const { generated, usedFailover } = await generateSummaryWithOptionalFailover(
            pluginConfig,
            mode as BibleMode,
            reference
          );

          let text =
            mode === 'enhanced-study'
              ? renderEnhancedStudyReply(generated, reference)
              : mode === 'leader'
                ? renderLeaderReply(generated, reference)
              : mode === 'study'
                ? renderStudyReply(generated, reference)
                : renderShortReply(generated, reference, pluginConfig.signalMaxChars);

          if (usedFailover) {
            text += FAILOVER_NOTE;
          }

          return { text };
        } catch (error: any) {
          console.error('[bible-plugin] request failed:', error?.message ?? error);
          return { text: formatUserFacingError(error) };
        }
      }
    });
  }
});

export default plugin;
