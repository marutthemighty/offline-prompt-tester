// background.ts - Complete, Clean, Production-Ready Version (No omissions)

const PLATFORM_CONFIG = {
  jan: { base: 'http://localhost:1337/v1', apiType: 'openai' as const, modelsEndpoint: '/models' },
  ollama: { base: 'http://localhost:11434', apiType: 'ollama' as const, modelsEndpoint: '/api/tags' },
  lmstudio: { base: 'http://localhost:1234/v1', apiType: 'openai' as const, modelsEndpoint: '/models' },
  custom: { base: '', apiType: 'openai' as const, modelsEndpoint: '/v1/models' }
} as const;

const PRO_SYSTEM_PROMPTS: Record<string, string> = {
  'add-ambiguity': 'You are an expert prompt engineer. Take the user prompt and add subtle ambiguity while keeping the core intent. Return ONLY the new prompt.',
  'remove-ambiguity': 'Make the following prompt crystal-clear and unambiguous. Return ONLY the new prompt.',
  'change-perspective': 'Rewrite the prompt from a completely different point of view (e.g. first-person, expert, beginner, critic). Return ONLY the new prompt.',
  'reverse-polarity': 'Invert the sentiment/perspective of the prompt while preserving the topic. Return ONLY the new prompt.',
  'add-constraints': 'Add 2-3 realistic constraints to the prompt (length, style, tone, format). Return ONLY the new prompt.',
  'remove-constraints': 'Remove all constraints from the prompt to make it completely open-ended. Return ONLY the new prompt.',
  'domain-shift': 'Shift the domain of the prompt to a completely different field while keeping the core request. Return ONLY the new prompt.',
  'role-injection': 'Inject a strong expert role at the beginning of the prompt. Return ONLY the new prompt.',
  'adversarial': 'Create an adversarial version of the prompt designed to test robustness of LLMs. Return ONLY the new prompt.'
};

const FREE_TYPES = ['rephrase', 'simplify', 'formalize', 'informalize'] as const;

// Levenshtein similarity (0-100)
function levenshteinSimilarity(a: string, b: string): number {
  const matrix = Array.from({ length: b.length + 1 }, () => Array(a.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j;
  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + cost
      );
    }
  }
  const distance = matrix[b.length][a.length];
  return Math.round(100 * (1 - distance / Math.max(a.length, b.length)));
}

// Rule-based free perturbations
const ruleBased: Record<string, (text: string) => string> = {
  rephrase: (text) => {
    const words = text.split(/\s+/);
    for (let i = words.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [words[i], words[j]] = [words[j], words[i]];
    }
    return words.join(' ');
  },
  simplify: (text) => text
    .replace(/very |extremely |really /gi, '')
    .replace(/ \w+ly/g, '')
    .replace(/\b\w{8,}\b/g, w => w.slice(0, 5) + '...')
    .trim(),
  formalize: (text) => text
    .replace(/don't/gi, 'do not')
    .replace(/can't/gi, 'cannot')
    .replace(/it's/gi, 'it is')
    .replace(/\b(?:want|need|got)\b/gi, m => m === 'want' ? 'desire' : m === 'need' ? 'require' : 'possess')
    .trim(),
  informalize: (text) => text
    .replace(/do not/gi, "don't")
    .replace(/cannot/gi, "can't")
    .replace(/it is/gi, "it's")
    .toLowerCase()
};

// Gumroad license verification
async function verifyGumroadLicense(key: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.gumroad.com/v2/licenses/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        product_id: "wMnfFiytcwhTpdaIylcvoQ==",
        license_key: key.trim()
      })
    });
    const data = await res.json();
    return data.success === true;
  } catch {
    return false;
  }
}

// Atomic daily state
async function getDailyState() {
  const { dailyData } = await chrome.storage.local.get('dailyData');
  const today = new Date().toISOString().split('T')[0];
  if (!dailyData || dailyData.date !== today) {
    const { licenseKey } = await chrome.storage.local.get('licenseKey');
    const isPro = licenseKey ? await verifyGumroadLicense(licenseKey) : false;
    const newData = { date: today, count: 0, isPro };
    await chrome.storage.local.set({ dailyData: newData });
    return newData;
  }
  return dailyData;
}

async function incrementDailyCount() {
  const state = await getDailyState();
  await chrome.storage.local.set({ dailyData: { ...state, count: state.count + 1 } });
}

// LLM call
async function callLLM(platform: string, customBase: string, model: string, messages: any[]) {
  const cfg = PLATFORM_CONFIG[platform as keyof typeof PLATFORM_CONFIG] || 
              { base: customBase || 'http://localhost:11434', apiType: 'openai', modelsEndpoint: '/v1/models' };
  let url = cfg.base;
  let body: any = {};

  if (cfg.apiType === 'ollama') {
    url += '/api/chat';
    body = { model, messages, stream: false };
  } else {
    url += '/v1/chat/completions';
    body = { model, messages, temperature: 0.7, max_tokens: 1024 };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text();
    if (text.toLowerCase().includes('model') && text.toLowerCase().includes('not found')) {
      throw new Error('MODEL_NOT_LOADED');
    }
    throw new Error(`HTTP ${res.status}`);
  }

  const data = await res.json();
  return cfg.apiType === 'ollama' 
    ? data.message?.content || '' 
    : data.choices?.[0]?.message?.content || '';
}

// Get models
async function getModels(platform: string, customBase: string): Promise<string[]> {
  const cfg = PLATFORM_CONFIG[platform as keyof typeof PLATFORM_CONFIG] || 
              { base: customBase, apiType: 'openai', modelsEndpoint: '/v1/models' };
  try {
    const res = await fetch(cfg.base + cfg.modelsEndpoint);
    if (!res.ok) throw new Error();
    const data = await res.json();
    if (cfg.apiType === 'ollama') return data.models?.map((m: any) => m.name) || [];
    return data.data?.map((m: any) => m.id) || [];
  } catch {
    return [];
  }
}

// Batch processing
async function processBatch(prompts: string[], types: string[], platform: string, model: string, customBase: string) {
  const batchResults: any[] = [];
  for (const basePrompt of prompts) {
    const entryResults: any[] = [];
    for (const type of types) {
      let perturbed = '';
      try {
        if (FREE_TYPES.includes(type as any)) {
          perturbed = ruleBased[type as keyof typeof ruleBased](basePrompt);
        } else {
          const system = PRO_SYSTEM_PROMPTS[type];
          perturbed = await callLLM(platform, customBase, model, [
            { role: 'system', content: system },
            { role: 'user', content: basePrompt }
          ]);
        }
      } catch (e: any) {
        perturbed = e.message === 'MODEL_NOT_LOADED' 
          ? '[ERROR] Please load the model in Jan.ai / Ollama / LM Studio first' 
          : `[ERROR] ${e.message}`;
      }
      const similarity = levenshteinSimilarity(basePrompt, perturbed);
      entryResults.push({ type, original: basePrompt, perturbed, similarity, timestamp: Date.now() });
    }
    batchResults.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      prompt: basePrompt,
      results: entryResults,
      timestamp: Date.now(),
      pinned: false
    });
  }

  const { history = [] } = await chrome.storage.local.get('history');
  await chrome.storage.local.set({ history: [...batchResults, ...history] });
  return batchResults;
}

// ====================== MESSAGE HANDLER ======================
chrome.runtime.onMessage.addListener((msg: any, sender: any, sendResponse: (response?: any) => void) => {
  (async () => {
    if (msg.action === 'getModels') {
      const models = await getModels(msg.platform, msg.customBase);
      sendResponse({ models });
      return;
    }

    if (msg.action === 'verifyLicense') {
      const valid = await verifyGumroadLicense(msg.key);
      if (valid) {
        await chrome.storage.local.set({ licenseKey: msg.key, isPro: true });
      }
      sendResponse({ valid });
      return;
    }

    if (msg.action === 'startGeneration') {
      const state = await getDailyState();
      if (!state.isPro && state.count >= 10) {
        sendResponse({ error: 'DAILY_LIMIT' });
        return;
      }

      const { prompt, types, platform, model, customBase } = msg;
      const results: any[] = [];

      for (const type of types) {
        let perturbed = '';
        try {
          if (FREE_TYPES.includes(type as any)) {
            perturbed = ruleBased[type as keyof typeof ruleBased](prompt);
          } else {
            const system = PRO_SYSTEM_PROMPTS[type];
            perturbed = await callLLM(platform, customBase, model, [
              { role: 'system', content: system },
              { role: 'user', content: prompt }
            ]);
          }
        } catch (e: any) {
          if (e.message === 'MODEL_NOT_LOADED') {
            sendResponse({ error: 'MODEL_NOT_LOADED' });
            return;
          }
          perturbed = `[ERROR] ${e.message}`;
        }
        const similarity = levenshteinSimilarity(prompt, perturbed);
        results.push({ type, original: prompt, perturbed, similarity, timestamp: Date.now() });
      }

      const newEntry = {
        id: Date.now().toString(36),
        prompt,
        results,
        timestamp: Date.now(),
        pinned: false
      };

      const { history = [] } = await chrome.storage.local.get('history');
      await chrome.storage.local.set({ history: [newEntry, ...history.slice(0, 199)] });

      if (!state.isPro) await incrementDailyCount();

      sendResponse({ success: true, results: newEntry });
      return;
    }

    if (msg.action === 'batchProcess') {
      const state = await getDailyState();
      if (!state.isPro && state.count >= 10) {
        sendResponse({ error: 'DAILY_LIMIT' });
        return;
      }

      const { prompts, types, platform, model, customBase } = msg;
      const batchResults = await processBatch(prompts, types, platform, model, customBase);

      if (!state.isPro) await incrementDailyCount();

      sendResponse({ success: true, results: batchResults });
      return;
    }

    if (msg.action === 'togglePin') {
      const { id } = msg;
      const { history = [] } = await chrome.storage.local.get('history');
      const updated = history.map((item: any) => 
        item.id === id ? { ...item, pinned: !item.pinned } : item
      );
      await chrome.storage.local.set({ history: updated });
      sendResponse({ success: true });
      return;
    }

    if (msg.action === 'deleteHistoryItem') {
      const { id } = msg;
      const { history = [] } = await chrome.storage.local.get('history');
      const updated = history.filter((item: any) => item.id !== id);
      await chrome.storage.local.set({ history: updated });
      sendResponse({ success: true });
      return;
    }

    if (msg.action === 'saveToLibrary') {
      const { prompt } = msg;
      const { library = [] } = await chrome.storage.local.get('library');
      const newItem = {
        id: Date.now().toString(36),
        prompt,
        timestamp: Date.now()
      };
      await chrome.storage.local.set({ library: [newItem, ...library] });
      sendResponse({ success: true });
      return;
    }
  })();

  return true; // Keep channel open for async response
});

// ====================== CONTEXT MENU ======================
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'test-prompt',
    title: 'Test with Offline Prompt Tester',
    contexts: ['selection']
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'test-prompt' && info.selectionText) {
    chrome.storage.local.set({ quickPrompt: info.selectionText }).then(() => {
      chrome.action.openPopup();
    });
  }
});

// ====================== OMNIBOX ======================
chrome.omnibox.onInputEntered.addListener((text) => {
  chrome.storage.local.set({ quickPrompt: text }).then(() => {
    chrome.action.openPopup();
  });
});

// Optional keep-alive
let keepAliveInterval: NodeJS.Timeout | null = null;
function startKeepAlive() {
  if (keepAliveInterval) return;
  keepAliveInterval = setInterval(() => {}, 25000);
}
