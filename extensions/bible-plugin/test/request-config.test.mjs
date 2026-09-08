import assert from 'node:assert/strict';
import test from 'node:test';

import plugin from '../dist/index.js';

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
