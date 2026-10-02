import { readFileSync, readdirSync } from 'node:fs';

import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import { SHIP_SCHEMA_ID, ShipEvidenceSchema } from '../src/schema.js';
import { GENERATOR_VERSION } from '../src/version.js';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const jsonSchema = JSON.parse(read('../schema/hey-ship.v1.json')) as Record<string, unknown>;
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
const validate = ajv.compile(jsonSchema);

const fixtures = (kind: 'valid' | 'invalid') =>
  readdirSync(new URL(`./fixtures/evidence/${kind}/`, import.meta.url))
    .filter((name) => name.endsWith('.json'))
    .map((name) => [name, JSON.parse(read(`./fixtures/evidence/${kind}/${name}`))] as const);

describe('hey.ship/v1 schema', () => {
  it('has fixtures of both kinds', () => {
    expect(fixtures('valid').length).toBeGreaterThanOrEqual(3);
    expect(fixtures('invalid').length).toBeGreaterThanOrEqual(20);
  });

  it.each(fixtures('valid'))('accepts %s in both the zod and the JSON Schema', (_name, doc) => {
    expect(ShipEvidenceSchema.safeParse(doc).success).toBe(true);
    expect(validate(doc), JSON.stringify(validate.errors)).toBe(true);
  });

  it.each(fixtures('invalid'))('refuses %s in both the zod and the JSON Schema', (_name, doc) => {
    expect(ShipEvidenceSchema.safeParse(doc).success).toBe(false);
    expect(validate(doc)).toBe(false);
  });

  it('publishes the $id the code names', () => {
    expect(jsonSchema.$id).toBe(SHIP_SCHEMA_ID);
  });

  it('pins chainId to the integer 4663', () => {
    const props = jsonSchema.properties as Record<string, Record<string, unknown>>;
    expect(props.chainId).toMatchObject({ const: 4663 });
    expect(props.declarationState).toMatchObject({ const: 'DECLARED' });
  });

  it('writes the package version as the generator version', () => {
    const pkg = JSON.parse(read('../package.json')) as { version: string };
    expect(GENERATOR_VERSION).toBe(pkg.version);
  });
});
