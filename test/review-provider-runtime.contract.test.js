import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareReviewProviderRuntime } from '../core/review-sandbox.js';

function setup(t, personal, builtin) {
  const root = mkdtempSync(join(tmpdir(), 'lzy-provider-runtime-'));
  const home = join(root, 'home'); mkdirSync(home);
  const personalPath = join(home, 'provider-config.sandbox.json');
  const builtinPath = join(root, 'builtin.json');
  writeFileSync(personalPath, JSON.stringify(personal)); writeFileSync(builtinPath, JSON.stringify(builtin));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { home, personalPath, builtinPath };
}
const modelDefaults = { modelRules: [], modelApiRules: [], providerSiteRules: [], templateModelRules: [], builtinProviderModelRules: [] };

test('selected PERSONAL provider retains same-id BUILTIN defaults and models without inheriting builtin credentials', t => {
  const personal = { schemaVersion: 1, config: { providerConfigRules: { providerRules: [{ providerId: 'selected', enabled: true, config: { access: { type: 'api-key', apiKey: 'PERSONAL-SELECTED' }, api: { baseUrl: 'http://127.0.0.1:4321/personal', headers: { Authorization: 'PERSONAL-HEADER' } } } }] } } };
  const builtin = { schemaVersion: 1, revision: 7, config: {
    providerConfigRules: {
      providerRules: [
        { providerId: 'selected', templateId: 'selected-template', providerName: 'Public default', unknownCredential: 'ROOT-SECRET', config: { group: 'zai-family', unknownCredential: 'CONFIG-SECRET', logo: { type: 'builtin', key: 'public-logo', unknownCredential: 'LOGO-SECRET' }, access: { type: 'api-key', apiKey: 'BUILTIN-SECRET', oauthToken: 'BUILTIN-OAUTH' }, api: { type: 'openai-chat-completions', baseUrl: 'http://127.0.0.1:4321/base', headers: { Authorization: 'BUILTIN-HEADER' } }, builtinModelIds: ['glm-4.7'] } },
        { providerId: 'other', config: { group: 'bigmodel-family', access: { type: 'api-key', apiKey: 'OTHER-SECRET' } } },
      ],
      templateRules: [
        { templateId: 'selected-template', templateNameMap: { 'en-US': 'Selected', unknownCredential: 'NAME-SECRET' }, unknownCredential: 'TEMPLATE-ROOT-SECRET', config: { unknownCredential: 'TEMPLATE-CONFIG-SECRET', access: { type: 'api-key', apiKey: 'TEMPLATE-SECRET' }, api: { type: 'openai-chat-completions', baseUrl: 'http://127.0.0.1:4321/template', headers: { Authorization: 'TEMPLATE-HEADER' } } } },
        { templateId: 'other-template', config: { access: { apiKey: 'OTHER-TEMPLATE-SECRET' } } },
      ],
    },
    modelConfigRules: { ...modelDefaults,
      builtinProviderModelRules: [{ providerId: 'selected', modelId: 'glm-4.7', config: { enabled: true } }, { providerId: 'other', modelId: 'other-model', config: { enabled: true } }],
      templateModelRules: [{ templateId: 'selected-template', modelId: 'glm-4.7', config: { enabled: true } }, { templateId: 'other-template', modelId: 'other-model', config: { enabled: true } }],
    },
  } };
  const paths = setup(t, personal, builtin);
  const result = prepareReviewProviderRuntime(paths.home, { ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: paths.personalPath }, paths.builtinPath);
  const copy = JSON.parse(readFileSync(result.providerEnv.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE, 'utf8'));
  assert.deepEqual(result.endpoints, ['http://127.0.0.1:4321/personal']);
  assert.equal(copy.config.providerConfigRules.providerRules.length, 1);
  const base = copy.config.providerConfigRules.providerRules[0];
  assert.equal(base.providerId, 'selected'); assert.equal(base.templateId, 'selected-template');
  assert.equal(base.config.group, 'zai-family');
  assert.deepEqual(base.config.builtinModelIds, ['glm-4.7']);
  assert.deepEqual(base.config.access, { type: 'api-key' });
  assert.deepEqual(base.config.logo, { type: 'builtin', key: 'public-logo' });
  assert.equal(base.unknownCredential, undefined);
  assert.equal(base.config.unknownCredential, undefined);
  assert.deepEqual(base.config.api, { type: 'openai-chat-completions', baseUrl: 'http://127.0.0.1:4321/base' });
  assert.equal(copy.config.providerConfigRules.templateRules.length, 1);
  assert.deepEqual(copy.config.providerConfigRules.templateRules[0].templateNameMap, { 'en-US': 'Selected' });
  assert.equal(copy.config.providerConfigRules.templateRules[0].unknownCredential, undefined);
  assert.equal(copy.config.providerConfigRules.templateRules[0].config.unknownCredential, undefined);
  assert.deepEqual(copy.config.providerConfigRules.templateRules[0].config.access, { type: 'api-key' });
  assert.equal(copy.config.providerConfigRules.templateRules[0].config.api.headers, undefined);
  assert.deepEqual(copy.config.modelConfigRules.builtinProviderModelRules.map(r => r.providerId), ['selected']);
  assert.deepEqual(copy.config.modelConfigRules.templateModelRules.map(r => r.templateId), ['selected-template']);
  assert.equal(JSON.stringify(copy).includes('SECRET'), false);
  assert.equal(JSON.stringify(copy).includes('OAUTH'), false);
  assert.equal(JSON.stringify(copy).includes('HEADER'), false);
  assert.deepEqual(JSON.parse(readFileSync(paths.personalPath, 'utf8')), personal);
  assert.deepEqual(JSON.parse(readFileSync(paths.builtinPath, 'utf8')), builtin);
});

test('inherited endpoint retains public BUILTIN API defaults; explicit PERSONAL template overrides remain selected', t => {
  const personal = { schemaVersion: 1, config: { providerConfigRules: { providerRules: [{ providerId: 'selected', templateId: 'override-template', config: { access: { type: 'api-key', apiKey: 'PERSONAL-SELECTED' } } }] } } };
  const builtin = { schemaVersion: 1, revision: 1, config: {
    providerConfigRules: { providerRules: [{ providerId: 'selected', templateId: 'base-template', config: { group: 'zai-family', api: { type: 'openai-chat-completions', baseUrl: 'http://127.0.0.1:4321/base' } } }], templateRules: [{ templateId: 'override-template', config: { api: { type: 'openai-chat-completions', baseUrl: 'http://127.0.0.1:4321/override' } } }, { templateId: 'base-template', config: {} }] },
    modelConfigRules: modelDefaults,
  } };
  const paths = setup(t, personal, builtin);
  const result = prepareReviewProviderRuntime(paths.home, { ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: paths.personalPath }, paths.builtinPath);
  const copy = JSON.parse(readFileSync(result.providerEnv.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE, 'utf8'));
  assert.equal(copy.config.providerConfigRules.providerRules[0].config.api.type, 'openai-chat-completions');
  assert.deepEqual(copy.config.providerConfigRules.templateRules.map(r => r.templateId), ['override-template', 'base-template']);
  assert.deepEqual(result.endpoints, ['http://127.0.0.1:4321/override']);
  assert.deepEqual(JSON.parse(readFileSync(paths.personalPath, 'utf8')), personal);
});
