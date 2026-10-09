import assert from 'node:assert/strict';
import test from 'node:test';

import plugin, {
  isFailoverEligibleError,
  resolveFailoverEndpoint,
  resolveRequestConfig
} from '../dist/index.js';

function getHandler() {
  let handler;
  plugin.register({
    registerCommand(command) {
      handler = command.handler;
    }
  });
  return handler;
}

function successfulResponse() {
  return {
    ok: true,
    json: async () => ({
      choices: [{
        message: {
          content: JSON.stringify({
            title: 'Test',
            reference: 'John 3',
            big_idea: 'Test response',
            passage_structure: ['John 3:1-8 — Jesus teaches Nicodemus'],
            discussion_questions: ['How does the book context sharpen your reading of John 3:1-8?'],
            action_step: 'John 3:21 — Practice walking openly in the light this week.',
            suggested_answers: ['John 3:1-8 shows that new birth is God’s work; participants may also notice Nicodemus’s confusion.'],
            follow_up_prompts: ['Which words in the passage led you there?'],
            facilitator_notes: ['Let the group answer before consulting these suggestions.'],
            closing_challenge: 'Walk openly in the light this week (John 3:21).'
          })
        }
      }]
    })
  };
}

test('Ollama uses configured endpoint, reasoning effort, and timeout without auth', async () => {
  const handler = getHandler();
  const originalFetch = globalThis.fetch;
  const originalTimeout = AbortSignal.timeout;
  let request;
  let timeoutMs;

  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return successfulResponse();
  };
  AbortSignal.timeout = (milliseconds) => {
    timeoutMs = milliseconds;
    return new AbortController().signal;
  };

  try {
    const result = await handler({
      args: 'john 3',
      config: {
        plugins: {
          entries: {
            'bible-plugin': {
              config: {
                provider: 'ollama',
                baseUrl: 'http://ollama.test/v1/chat/completions',
                model: 'qwen3.5:27b',
                reasoningEffort: 'none',
                requestTimeoutMs: 300000
              }
            }
          }
        }
      }
    });
    assert.match(result.text, /Discussion questions:/);
    assert.match(result.text, /book context sharpen/);
    assert.match(result.text, /Action step:/);
  } finally {
    globalThis.fetch = originalFetch;
    AbortSignal.timeout = originalTimeout;
  }

  const payload = JSON.parse(request.options.body);
  assert.equal(request.url, 'http://ollama.test/v1/chat/completions');
  assert.equal(payload.model, 'qwen3.5:27b');
  assert.equal(payload.reasoning_effort, 'none');
  assert.equal(timeoutMs, 300000);
  assert.equal(request.options.headers.Authorization, undefined);
});

test('Leader mode renders the full study plus facilitator guidance', async () => {
  const handler = getHandler();
  const originalFetch = globalThis.fetch;
  let request;

  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return successfulResponse();
  };

  try {
    const result = await handler({
      args: '--leader john 3',
      config: { plugins: { entries: { 'bible-plugin': { config: { provider: 'ollama' } } } } }
    });
    assert.match(result.text, /Discussion questions:/);
    assert.match(result.text, /Suggested responses:/);
    assert.match(result.text, /Follow-up prompts:/);
    assert.match(result.text, /Facilitator notes:/);
    assert.match(result.text, /Closing challenge:/);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const payload = JSON.parse(request.options.body);
  assert.equal(payload.max_tokens, 2600);
  assert.match(payload.messages[1].content, /Mode: leader/);
});

test('Leader mode accepts named and mode selectors', async () => {
  const handler = getHandler();
  const originalFetch = globalThis.fetch;
  const prompts = [];

  globalThis.fetch = async (_url, options) => {
    prompts.push(JSON.parse(options.body).messages[1].content);
    return successfulResponse();
  };

  try {
    for (const args of ['leader john 3', '--mode=leader john 3', '--mode leader john 3']) {
      await handler({
        args,
        config: { plugins: { entries: { 'bible-plugin': { config: { provider: 'ollama' } } } } }
      });
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(prompts.length, 3);
  for (const prompt of prompts) {
    assert.match(prompt, /Mode: leader/);
    assert.match(prompt, /Reference: john 3/);
  }
});

test('OpenRouter keeps bearer authentication and omits Ollama reasoning control', async () => {
  const handler = getHandler();
  const originalFetch = globalThis.fetch;
  let request;

  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return successfulResponse();
  };

  try {
    const result = await handler({
      args: '--enhanced-study john 3',
      config: {
        plugins: {
          entries: {
            'bible-plugin': {
              config: {
                provider: 'openrouter',
                baseUrl: 'http://proxy.test/v1/chat/completions',
                model: 'openrouter/test-model',
                openrouterApiKey: 'test-key'
              }
            }
          }
        }
      }
    });
    assert.match(result.text, /Passage structure:/);
    assert.match(result.text, /John 3:1-8/);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const payload = JSON.parse(request.options.body);
  assert.equal(request.url, 'http://proxy.test/v1/chat/completions');
  assert.equal(request.options.headers.Authorization, 'Bearer test-key');
  assert.equal(payload.reasoning_effort, undefined);
});

test('OpenRouter HTTP errors surface quota and status details to the user', async () => {
  const handler = getHandler();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    ok: false,
    status: 429,
    text: async () =>
      JSON.stringify({
        error: {
          message: 'Rate limit exceeded: free-models-per-day',
          code: 429
        }
      })
  });

  try {
    const result = await handler({
      args: 'john 3',
      config: {
        plugins: {
          entries: {
            'bible-plugin': {
              config: {
                provider: 'openrouter',
                openrouterApiKey: 'test-key'
              }
            }
          }
        }
      }
    });
    assert.match(result.text, /HTTP 429/);
    assert.match(result.text, /Rate limit exceeded/);
    assert.match(result.text, /quota/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('resolveRequestConfig merges per-mode overrides', () => {
  const config = {
    provider: 'ollama',
    baseUrl: 'http://ollama.test/v1/chat/completions',
    model: 'qwen3.5:27b',
    reasoningEffort: 'none',
    requestTimeoutMs: 300000,
    signalMaxChars: 1400,
    defaultMode: 'study',
    modes: {
      short: {
        provider: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
        model: 'google/gemini-3-flash-preview',
        requestTimeoutMs: 60000
      }
    }
  };

  const study = resolveRequestConfig(config, 'study');
  assert.equal(study.provider, 'ollama');
  assert.equal(study.model, 'qwen3.5:27b');

  const short = resolveRequestConfig(config, 'short');
  assert.equal(short.provider, 'openrouter');
  assert.equal(short.model, 'google/gemini-3-flash-preview');
  assert.equal(short.requestTimeoutMs, 60000);
});

test('Ollama primary failure fails over to OpenRouter when mode opts in', async () => {
  const handler = getHandler();
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = async (url, options) => {
    calls += 1;
    if (calls === 1) {
      throw new Error('fetch failed');
    }
    assert.match(String(url), /openrouter\.failover/);
    assert.equal(options.headers.Authorization, 'Bearer failover-key');
    return successfulResponse();
  };

  try {
    const result = await handler({
      args: '--leader john 3',
      config: {
        plugins: {
          entries: {
            'bible-plugin': {
              config: {
                provider: 'ollama',
                baseUrl: 'http://ollama.test/v1/chat/completions',
                model: 'qwen3.5:27b',
                openrouterApiKey: 'failover-key',
                failover: {
                  baseUrl: 'http://openrouter.failover/v1/chat/completions',
                  model: 'google/gemini-3-flash-preview'
                },
                modes: {
                  leader: { failover: true }
                }
              }
            }
          }
        }
      }
    });
    assert.equal(calls, 2);
    assert.match(result.text, /Closing challenge:/);
    assert.match(result.text, /OpenRouter fallback/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Ollama HTTP 404 does not attempt failover', async () => {
  const handler = getHandler();
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = async () => {
    calls += 1;
    return {
      ok: false,
      status: 404,
      text: async () => 'model not found'
    };
  };

  try {
    const result = await handler({
      args: '--leader john 3',
      config: {
        plugins: {
          entries: {
            'bible-plugin': {
              config: {
                provider: 'ollama',
                baseUrl: 'http://ollama.test/v1/chat/completions',
                model: 'missing-model',
                openrouterApiKey: 'failover-key',
                failover: { model: 'google/gemini-3-flash-preview' },
                modes: { leader: { failover: true } }
              }
            }
          }
        }
      }
    });
    assert.equal(calls, 1);
    assert.match(result.text, /HTTP 404/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('isFailoverEligibleError accepts network failures for Ollama only', () => {
  assert.equal(isFailoverEligibleError(new Error('fetch failed'), 'ollama'), true);
  assert.equal(isFailoverEligibleError(new Error('fetch failed'), 'openrouter'), false);
  assert.equal(
    isFailoverEligibleError(new Error('Model API error (404): missing'), 'ollama'),
    false
  );
  assert.equal(
    isFailoverEligibleError(new Error('Model API error (503): unavailable'), 'ollama'),
    true
  );
});

test('resolveFailoverEndpoint returns undefined when mode failover is disabled', () => {
  const config = {
    provider: 'ollama',
    baseUrl: 'http://ollama.test/v1/chat/completions',
    model: 'qwen3.5:27b',
    reasoningEffort: 'none',
    requestTimeoutMs: 300000,
    signalMaxChars: 1400,
    defaultMode: 'study',
    failover: { model: 'google/gemini-3-flash-preview' },
    modes: { leader: { failover: false } }
  };
  assert.equal(resolveFailoverEndpoint(config, 'leader'), undefined);
});

test('Missing OpenRouter key returns the configured setup message', async () => {
  const handler = getHandler();
  const originalFetch = globalThis.fetch;
  const originalEnv = process.env.OPENROUTER_API_KEY;

  delete process.env.OPENROUTER_API_KEY;
  globalThis.fetch = async () => {
    throw new Error('fetch should not run when the API key is missing');
  };

  try {
    const result = await handler({
      args: 'john 3',
      config: {
        plugins: {
          entries: {
            'bible-plugin': {
              config: { provider: 'openrouter' }
            }
          }
        }
      }
    });
    assert.match(result.text, /OpenRouter API key/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEnv === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalEnv;
    }
  }
});
