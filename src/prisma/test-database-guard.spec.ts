import { assertLocalTestDatabase } from './test-database-guard';

describe('assertLocalTestDatabase', () => {
  const original = process.env.ALLOW_REMOTE_TEST_DB;
  afterEach(() => {
    if (original === undefined) delete process.env.ALLOW_REMOTE_TEST_DB;
    else process.env.ALLOW_REMOTE_TEST_DB = original;
  });

  it.each([
    'postgresql://postgres:postgres@127.0.0.1:44322/postgres',
    'postgresql://postgres:postgres@localhost:5432/postgres',
    'postgresql://postgres:postgres@postgres:5432/postgres',
  ])('accepts local database %s', (url) => {
    expect(() => assertLocalTestDatabase(url)).not.toThrow();
  });

  it('rejects a hosted database', () => {
    expect(() =>
      assertLocalTestDatabase(
        'postgresql://u:p@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres',
      ),
    ).toThrow(/non-local/);
  });

  it('fails closed when the URL is missing or malformed', () => {
    expect(() => assertLocalTestDatabase(undefined)).toThrow(/not set/);
    expect(() => assertLocalTestDatabase('not a url')).toThrow(/not a valid/);
  });

  it('allows an explicit override', () => {
    process.env.ALLOW_REMOTE_TEST_DB = '1';
    expect(() =>
      assertLocalTestDatabase('postgresql://u:p@db.example.com/x'),
    ).not.toThrow();
  });
});
