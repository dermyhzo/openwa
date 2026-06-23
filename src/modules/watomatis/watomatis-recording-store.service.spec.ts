import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { WatomatisRecordingStore } from './watomatis-recording-store.service';

describe('WatomatisRecordingStore', () => {
  let store: WatomatisRecordingStore;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'watomatis-rec-test-'));
    process.env.WATOMATIS_DATA_DIR = tmpDir;
    store = new WatomatisRecordingStore();
  });

  afterEach(async () => {
    delete process.env.WATOMATIS_DATA_DIR;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should return empty list for unknown session', async () => {
    const items = await store.list('unknown-session');
    expect(items).toEqual([]);
  });

  it('should append entries and list them with ts', async () => {
    const sessionId = 'test-session';
    await store.append(sessionId, { question: 'Harga berapa?', answer: 'Rp 100.000' });
    await store.append(sessionId, { question: 'Bisa COD?', answer: 'Ya bisa!' });

    const items = await store.list(sessionId);
    expect(items).toHaveLength(2);
    expect(items[0].question).toBe('Harga berapa?');
    expect(items[0].answer).toBe('Rp 100.000');
    expect(typeof items[0].ts).toBe('string');
    expect(new Date(items[0].ts).getTime()).not.toBeNaN();
    expect(items[1].question).toBe('Bisa COD?');
  });

  it('count returns number of entries', async () => {
    const sessionId = 'count-session';
    expect(await store.count(sessionId)).toBe(0);
    await store.append(sessionId, { question: 'Q1', answer: 'A1' });
    await store.append(sessionId, { question: 'Q2', answer: 'A2' });
    expect(await store.count(sessionId)).toBe(2);
  });

  it('clear empties the list', async () => {
    const sessionId = 'clear-session';
    await store.append(sessionId, { question: 'Q', answer: 'A' });
    expect(await store.count(sessionId)).toBe(1);
    await store.clear(sessionId);
    expect(await store.count(sessionId)).toBe(0);
    expect(await store.list(sessionId)).toEqual([]);
  });
});
