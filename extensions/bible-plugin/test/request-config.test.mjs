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
            action_step: 'John 3:21 — Practice walking openly in the light this week.'
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
