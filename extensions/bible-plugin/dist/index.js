import { readFile } from 'node:fs/promises';
import { definePluginEntry } from 'openclaw/plugin-sdk/core';
const PLUGIN_ID = 'bible-plugin';
const PLUGIN_NAME = 'Bible Plugin';
const MISSING_OPENROUTER_API_KEY_MESSAGE = 'Bible plugin needs an OpenRouter API key configured via plugin config field openrouterApiKey or OPENROUTER_API_KEY.';
const DEFAULTS = {
    provider: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'google/gemini-2.5-flash',
    reasoningEffort: 'none',
    requestTimeoutMs: 45000,
    signalMaxChars: 1400,
    defaultMode: 'study'
};
function isReasoningEffort(value) {
    return value === 'none' || value === 'low' || value === 'medium' || value === 'high' || value === 'max';
}
function getPluginConfig(fullConfig) {
    const entry = fullConfig?.plugins?.entries?.[PLUGIN_ID];
    const raw = entry?.config ?? entry ?? {};
    return {
        provider: raw.provider === 'ollama' ? 'ollama' : DEFAULTS.provider,
        baseUrl: typeof raw.baseUrl === 'string' && raw.baseUrl.trim()
            ? raw.baseUrl.trim()
            : DEFAULTS.baseUrl,
        model: typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : DEFAULTS.model,
        reasoningEffort: isReasoningEffort(raw.reasoningEffort)
            ? raw.reasoningEffort
            : DEFAULTS.reasoningEffort,
        requestTimeoutMs: Number.isInteger(raw.requestTimeoutMs) && raw.requestTimeoutMs >= 1000 && raw.requestTimeoutMs <= 900000
            ? raw.requestTimeoutMs
            : DEFAULTS.requestTimeoutMs,
        signalMaxChars: Number.isInteger(raw.signalMaxChars) ? raw.signalMaxChars : DEFAULTS.signalMaxChars,
        defaultMode: raw.defaultMode === 'short' ||
            raw.defaultMode === 'study' ||
            raw.defaultMode === 'enhanced-study'
            ? raw.defaultMode
            : DEFAULTS.defaultMode,
        openrouterApiKey: typeof raw.openrouterApiKey === 'string' && raw.openrouterApiKey.trim()
            ? raw.openrouterApiKey.trim()
            : undefined
    };
}
function normalizeModeToken(token) {
    return token
        .normalize('NFKC')
        .replace(/[‐‑‒–—―]/g, '-') // normalize unicode dashes to ASCII '-'
        .toLowerCase();
}
function parseCommandArgs(args, defaultMode) {
    const trimmed = (args ?? '').trim();
    if (!trimmed) {
        return { mode: defaultMode, reference: '' };
    }
    const tokens = trimmed.split(/\s+/);
    let mode = defaultMode;
    const remainder = [];
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
            if (next === 'enhanced-study' || next === 'es' || next === 'enhanced') {
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
        if (normalized === '--enhanced' ||
            normalized === '--enhanced-study' ||
            normalized === '--es' ||
            normalized === 'es' ||
            normalized === 'enhanced' ||
            normalized === 'enhanced-study') {
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
        '/bible --enhanced-study matthew 25',
        '/bible study matthew 25',
        '/bible --es matthew 25',
        '/bible --mode=enhanced-study matthew 25',
    ].join('\n');
}
async function loadPromptTemplate(mode) {
    const filename = mode === 'study' ? './prompts/study.md' : mode === 'enhanced-study' ? './prompts/enhanced-study.md' : './prompts/short.md';
    const url = new URL(filename, import.meta.url);
    return (await readFile(url, 'utf8')).trim() + '\n';
}
function fillPrompt(template, reference) {
    return template.replaceAll('{reference}', reference);
}
function normalizeFields(data) {
    const normalized = {};
    for (const [key, value] of Object.entries(data)) {
        const cleanKey = key.trim().toLowerCase().replace(/[-\s]+/g, '_');
        normalized[cleanKey] = value;
    }
    return normalized;
}
function extractJsonContent(content) {
    if (content && typeof content === 'object' && !Array.isArray(content)) {
        return content;
    }
    let text = String(content ?? '').trim();
    const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenced) {
        text = fenced[1].trim();
    }
    try {
        return JSON.parse(text);
    }
    catch {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
            return JSON.parse(text.slice(start, end + 1));
        }
        throw new Error('Model response did not contain parseable JSON');
    }
}
function cleanText(value) {
    if (!value)
        return '';
    return String(value).replace(/\s+/g, ' ').trim();
}
function normalizeStudyKeyPoints(generated) {
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
    const stripMarker = (line) => line
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
function firstSentences(value, count) {
    const cleaned = cleanText(value);
    if (!cleaned)
        return '';
    const parts = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
    return parts.slice(0, count).join(' ').trim();
}
function trimText(text, limit) {
    if (text.length <= limit)
        return text;
    let truncated = text.slice(0, limit - 3);
    const cut = truncated.lastIndexOf(' ');
    if (cut > 0) {
        truncated = truncated.slice(0, cut);
    }
    return truncated + '...';
}
function renderShortReply(generated, reference, signalMaxChars) {
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
function renderStudyReply(generated, reference) {
    const keyPoints = normalizeStudyKeyPoints(generated).map((item) => `- ${item}`);
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
        cleanText(generated.application) ? `Application: ${cleanText(generated.application)}` : '',
        cleanText(generated.prayer) ? `Prayer: ${cleanText(generated.prayer)}` : ''
    ].filter(Boolean);
    return sections.join('\n\n');
}
function normalizeStringArray(value) {
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
function renderEnhancedStudyReply(generated, reference) {
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
        explicitTeaching.length ? `Explicit teaching:\n${explicitTeaching.join('\n')}` : '',
        supportedInferences.length ? `Supported inferences:\n${supportedInferences.join('\n')}` : '',
        keyPoints.length ? `Key points:\n${keyPoints.join('\n')}` : '',
        cleanText(generated.application) ? `Application: ${cleanText(generated.application)}` : '',
        cleanText(generated.prayer) ? `Prayer: ${cleanText(generated.prayer)}` : ''
    ].filter(Boolean);
    return sections.join('\n\n');
}
function resolveOpenRouterApiKey(config) {
    if (config.openrouterApiKey) {
        return config.openrouterApiKey;
    }
    const envKey = process.env.OPENROUTER_API_KEY?.trim();
    if (envKey) {
        return envKey;
    }
    throw new Error(MISSING_OPENROUTER_API_KEY_MESSAGE);
}
async function generateSummary(config, mode, reference) {
    const promptTemplate = await loadPromptTemplate(mode);
    const prompt = fillPrompt(promptTemplate, reference);
    const apiKey = config.provider === 'openrouter'
        ? resolveOpenRouterApiKey(config)
        : undefined;
    const payload = {
        model: config.model,
        temperature: mode === 'enhanced-study' ? 0.45 :
            mode === 'study' ? 0.5 :
                0.4,
        max_tokens: mode === 'enhanced-study' ? 3200 :
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
    const headers = {
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
const plugin = definePluginEntry({
    id: PLUGIN_ID,
    name: PLUGIN_NAME,
    description: 'OpenClaw-native /bible slash command for devotional and study summaries.',
    register(api) {
        api.registerCommand({
            name: 'bible',
            description: 'Summarize a Bible chapter in short, study, or enhanced-study mode.',
            acceptsArgs: true,
            handler: async (ctx) => {
                const pluginConfig = getPluginConfig(ctx.config);
                const { mode, reference } = parseCommandArgs(ctx.args, pluginConfig.defaultMode);
                if (!reference) {
                    return { text: usageText() };
                }
                try {
                    const generated = await generateSummary(pluginConfig, mode, reference);
                    const text = mode === 'enhanced-study'
                        ? renderEnhancedStudyReply(generated, reference)
                        : mode === 'study'
                            ? renderStudyReply(generated, reference)
                            : renderShortReply(generated, reference, pluginConfig.signalMaxChars);
                    return { text };
                }
                catch (error) {
                    console.error('[bible-plugin] request failed:', error?.message ?? error);
                    return {
                        text: error?.message === MISSING_OPENROUTER_API_KEY_MESSAGE
                            ? MISSING_OPENROUTER_API_KEY_MESSAGE
                            : 'Bible plugin could not complete that request right now. Please try again in a moment.'
                    };
                }
            }
        });
    }
});
export default plugin;
