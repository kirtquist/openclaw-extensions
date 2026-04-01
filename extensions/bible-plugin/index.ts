import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';

const PLUGIN_ID = 'bible-plugin';
const PLUGIN_NAME = 'Bible Plugin';
const AUTH_FILE = `${homedir()}/.openclaw/agents/main/agent/auth-profiles.json`;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULTS = {
  model: 'google/gemini-2.5-flash',
  signalMaxChars: 1400,
  defaultMode: 'study',
  openrouterProfile: 'openrouter:default'
} as const;

function getPluginConfig(fullConfig: any) {
  const entry = fullConfig?.plugins?.entries?.[PLUGIN_ID];
  const raw = entry?.config ?? entry ?? {};
  return {
    model: typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : DEFAULTS.model,
    signalMaxChars: Number.isInteger(raw.signalMaxChars) ? raw.signalMaxChars : DEFAULTS.signalMaxChars,
    defaultMode: raw.defaultMode === 'study' ? 'study' : DEFAULTS.defaultMode,
    openrouterProfile:
      typeof raw.openrouterProfile === 'string' && raw.openrouterProfile.trim()
        ? raw.openrouterProfile.trim()
        : DEFAULTS.openrouterProfile
  };
}
function normalizeModeToken(token: string) {
  return token
    .normalize('NFKC')
    .replace(/[‐‑‒–—―]/g, '-') // normalize unicode dashes to ASCII '-'
    .toLowerCase();
}

function parseCommandArgs(args: string | undefined, defaultMode: 'short' | 'study') {
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
    }

    if (normalized === '--study' || normalized === '-s' || normalized === 'study') {
      mode = 'study';
      continue;
    }
    if (normalized === '--short' || normalized === '-d' || normalized === 'short') {
      mode = 'short';
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
    '/bible study matthew 25',
  ].join('\n');
}

async function loadPromptTemplate(mode: 'short' | 'study') {
  const filename = mode === 'study' ? './prompts/study.md' : './prompts/short.md';
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

  const sections = [
    cleanText(generated.title) || reference,
    `Reference: ${cleanText(generated.reference) || reference}`,
    cleanText(generated.big_idea) ? `Big idea: ${cleanText(generated.big_idea)}` : '',
    cleanText(generated.historical_context ?? generated.historicalcontext)
      ? `Historical context: ${cleanText(generated.historical_context ?? generated.historicalcontext)}`
      : '',
    keyPoints.length ? `Key points:\n${keyPoints.join('\n')}` : '',
    cleanText(generated.application) ? `Application: ${cleanText(generated.application)}` : '',
    cleanText(generated.prayer) ? `Prayer: ${cleanText(generated.prayer)}` : ''
  ].filter(Boolean);

  return sections.join('\n\n');
}

async function loadOpenRouterKey(profileName: string) {
  const auth = JSON.parse(await readFile(AUTH_FILE, 'utf8'));
  const key = auth?.profiles?.[profileName]?.key;
  if (!key || typeof key !== 'string') {
    throw new Error(`OpenRouter profile not found: ${profileName}`);
  }
  return key;
}

async function generateSummary(config: ReturnType<typeof getPluginConfig>, mode: 'short' | 'study', reference: string) {
  const promptTemplate = await loadPromptTemplate(mode);
  const prompt = fillPrompt(promptTemplate, reference);
  const apiKey = await loadOpenRouterKey(config.openrouterProfile);
  const payload = {
    model: config.model,
    temperature: mode === 'study' ? 0.5 : 0.4,
    max_tokens: mode === 'study' ? 1500 : 700,
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

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://openclaw.local',
      'X-Title': 'OpenClaw Bible Plugin'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`OpenRouter error (${response.status}): ${body}`);
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

const plugin = {
  id: PLUGIN_ID,
  name: PLUGIN_NAME,
  description: 'OpenClaw-native /bible slash command for devotional and study summaries.',
  register(api: any) {
    api.registerCommand({
      name: 'bible',
      description: 'Summarize a Bible chapter in short devotional or study mode.',
      acceptsArgs: true,
      handler: async (ctx: any) => {
        const pluginConfig = getPluginConfig(ctx.config);
        const { mode, reference } = parseCommandArgs(ctx.args, pluginConfig.defaultMode as 'short' | 'study');

        if (!reference) {
          return { text: usageText() };
        }

        try {
          const generated = await generateSummary(pluginConfig, mode as 'short' | 'study', reference);
          const text = mode === 'study'
            ? renderStudyReply(generated, reference)
            : renderShortReply(generated, reference, pluginConfig.signalMaxChars);
          return { text };
        } catch (error: any) {
          return {
            text:
              error?.message && String(error.message).includes('OpenRouter profile not found')
                ? 'Bible plugin is missing a usable OpenRouter profile. Check plugin config and auth profiles.'
                : 'Bible plugin could not complete that request right now. Please try again in a moment.'
          };
        }
      }
    });
  }
};

export default plugin;
