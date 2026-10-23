import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {buildChapterMaps, chapterPresentation} from '../../scripts/xp2-adapter/build-chapter-maps.mjs';
import {graphStory} from '../../private/story-player/src/playback.js';

const base = new URL('../../private/story-player/data/', import.meta.url);
const source = fs.readFileSync(new URL('story.json', base));
const raw = JSON.parse(source);
const translations = JSON.parse(fs.readFileSync(new URL('translations.json', base), 'utf8'));
const expected = buildChapterMaps(raw, {translations});
const manifest = JSON.parse(fs.readFileSync(new URL('chapter-map/manifest.json', base), 'utf8'));
const {storySha256, ...comparableManifest} = manifest;
assert.equal(storySha256, crypto.createHash('sha256').update(source).digest('hex'), 'static maps belong to the installed story');
assert.deepEqual(comparableManifest, expected.manifest, 'manifest reproducibly matches the source');
const stored = manifest.chapters.map(chapter => JSON.parse(fs.readFileSync(new URL(`chapter-map/${chapter.file}`, base), 'utf8')));
assert.deepEqual(stored, expected.models, 'every lazy chapter payload is reproducible');
assert.equal(manifest.totals.chapters, 55);
assert.equal(manifest.totals.scenes, 1442);
assert.equal(manifest.totals.storyScenes, 1083);
assert.equal(manifest.totals.referenceScenes, 359);
assert.equal(manifest.chapters.filter(chapter => chapter.category === 'story').length, 55);
assert.equal(manifest.chapters.filter(chapter => chapter.category === 'reference').length, 13);
assert.equal(Object.keys(manifest.sceneToChapter).length, raw.scenes.length);
assert.deepEqual(new Set(Object.keys(manifest.sceneToChapter)), new Set(raw.scenes.map(scene => scene.id)));
assert.equal(manifest.sceneToChapter[raw.startScene], 'chapter-22-row-1');
assert.equal(chapterPresentation({id: 'chapter-2-row-1', title: 'Scene_GameOver@11'}).section, 'ending');
assert.equal(chapterPresentation({id: 'chapter-55-row-1', title: 'omake_1'}).section, 'extra');
assert.equal(chapterPresentation({id: 'chapter-22-row-1', title: 'Start'}).title, '故事开始');

const rawEdges = graphStory(raw).graphEdges;
const allEdges = stored.flatMap(model => model.edges);
assert.equal(allEdges.length, rawEdges.length, 'all raw outgoing alternatives remain available');
for (const edge of rawEdges) {
  const actual = allEdges.find(item => item.id === edge.id);
  for (const [key, value] of Object.entries(edge)) assert.deepEqual(actual[key], value, `preserve edge ${edge.id}.${key}`);
  assert.equal(actual.toChapterId, manifest.sceneToChapter[actual.to]);
  assert.equal(actual.crossChapter, manifest.sceneToChapter[actual.from] !== actual.toChapterId);
}

let compressedContinuations = 0, maxScenes = 0, maxSegments = 0, maxChapterBytes = 0;
for (const model of stored) {
  const ids = new Set(model.scenes.map(scene => scene.id));
  const sceneMap = new Map(model.scenes.map(scene => [scene.id, scene]));
  const segmentMap = new Map(model.segments.map(segment => [segment.id, segment]));
  const partition = model.segments.flatMap(segment => segment.sceneIds);
  assert.equal(partition.length, model.scenes.length);
  assert.deepEqual(new Set(partition), ids, `${model.id}: no collapsed scene is lost or duplicated`);
  assert.equal(new Set(partition).size, partition.length);
  for (const segment of model.segments) {
    assert.equal(segment.entrySceneId, segment.sceneIds[0]);
    assert.equal(typeof segment.displayLabel, 'string');
    assert(segment.displayLabel.length > 0 && [...segment.displayLabel].length <= 32, 'reader summaries are nonempty and bounded by Unicode characters');
    assert(Number.isInteger(segment.tier) && segment.tier >= 0 && segment.tier < model.segments.length);
    assert(Number.isInteger(segment.depth) && segment.depth >= 0 && segment.depth < model.segments.length);
    assert.deepEqual(segment.outgoing, model.edges.filter(edge => edge.fromSegment === segment.id && !edge.internal).map(edge => edge.id));
    for (let index = 0; index < segment.sceneIds.length; index++) {
      const id = segment.sceneIds[index];
      assert.equal(sceneMap.get(id).segmentId, segment.id);
      if (index === segment.sceneIds.length - 1) continue;
      const edges = model.edges.filter(edge => edge.from === id);
      assert.equal(edges.length, 1, 'a summary never hides an intermediate branch');
      assert.equal(edges[0].to, segment.sceneIds[index + 1]);
      assert.equal(edges[0].kind, 'next');
      assert.equal(edges[0].label, '');
      assert.equal(edges[0].internal, true);
      compressedContinuations++;
    }
  }
  for (const edge of model.edges) {
    assert(ids.has(edge.from));
    assert(segmentMap.has(edge.fromSegment));
    assert.equal(ids.has(edge.to), !edge.crossChapter);
    if (!edge.crossChapter) assert.equal(edge.toSegment, sceneMap.get(edge.to).segmentId);
    if (edge.internal) assert.equal(edge.fromSegment, edge.toSegment);
    if (edge.terminal) assert(!edge.internal, 'a terminal alternative remains visible');
  }
  for (const scene of model.scenes) {
    assert.equal(manifest.sceneToChapter[scene.id], model.id);
    assert(!('events' in scene) && !('commands' in scene) && !('assets' in scene));
  }
  maxScenes = Math.max(maxScenes, model.scenes.length);
  maxSegments = Math.max(maxSegments, model.segments.length);
  maxChapterBytes = Math.max(maxChapterBytes, Buffer.byteLength(JSON.stringify(model)) + 1);
}
assert(compressedContinuations > 400, 'linear sequences are summarized instead of drawing one card per clip');
assert.equal(maxScenes, 129);
assert(maxChapterBytes < 128 * 1024, 'even the largest chapter stays below a small payload budget');
const manifestBytes = fs.statSync(new URL('chapter-map/manifest.json', base)).size;
assert(manifestBytes < 80 * 1024, 'the map startup index stays small');
assert(stored.every(model => model.scenes.length < raw.scenes.length / 10), 'no lazy payload contains the global map');
assert(stored.some(model => model.scenes.some(scene => scene.label.includes(' · '))), 'jump labels include short, recognizable text');

// A fork, a terminal option and a foreign entrance cannot be swallowed by a summary run.
const scene = (id, group = 'main') => ({id, title: id, chapter: group, mapGroup: group, events: []});
const synthetic = {id: 'synthetic', startScene: 'a', scenes: [scene('a'), scene('b'), scene('c'), scene('d'), scene('e'), scene('x', 'foreign'), scene('p', 'loop'), scene('q', 'loop')], program: {nodes: {
  a: {sceneId: 'a', exit: {type: 'goto', target: 'b'}},
  b: {sceneId: 'b', exit: {type: 'goto', target: 'c'}},
  c: {sceneId: 'c', exit: {type: 'choices', items: [{id: 'go', label: '继续', then: {type: 'goto', target: 'd'}}, {id: 'retry', label: '重试', then: {type: 'goto', target: 'a'}}, {id: 'end', label: '结束', then: {type: 'end'}}]}},
  d: {sceneId: 'd', exit: {type: 'goto', target: 'e'}},
  e: {sceneId: 'e', exit: {type: 'end'}},
  x: {sceneId: 'x', exit: {type: 'goto', target: 'b'}},
  p: {sceneId: 'p', exit: {type: 'goto', target: 'q'}},
  q: {sceneId: 'q', exit: {type: 'goto', target: 'p'}},
}}};
const fixture = buildChapterMaps(synthetic), main = fixture.models.find(model => model.id === 'main');
assert.deepEqual(main.segments.map(segment => segment.sceneIds), [['a'], ['b', 'c'], ['d', 'e']]);
assert.equal(main.edges.filter(edge => edge.from === 'c').length, 3);
assert.equal(main.edges.find(edge => edge.label === '结束').terminal, true);
assert(main.scenes.find(scene => scene.id === 'c').terminal);
const loop = fixture.models.find(model => model.id === 'loop');
assert.equal(loop.segments.length, 1);
assert.equal(loop.segments[0].cycle, true);
assert.equal(loop.edges.length, 2);
assert.equal(loop.edges.filter(edge => !edge.internal).length, 1, 'the closing loop is not hidden');
assert(Number.isFinite(loop.segments[0].depth));
assert.equal(loop.segments[0].displayLabel, '回环剧情');
assert.equal(main.segments.find(segment => segment.sceneIds.includes('c')).displayLabel, '分支选择');
assert.equal(main.segments.find(segment => segment.sceneIds.includes('e')).displayLabel, '章节结束');

// Summaries prefer available translations and keep numeric lookup labels intact.
const previewStory = structuredClone(synthetic);
previewStory.scenes.find(item => item.id === 'b').events = [{type: 'dialogue', textId: 'untranslated'}, {type: 'dialogue', textId: 'translated'}];
previewStory.texts = [{id: 'untranslated', source: 'Original opening'}, {id: 'translated', source: 'Original next line'}];
const previewText = '<b>译文预览</b> ' + '🌸'.repeat(40);
const previewMaps = buildChapterMaps(previewStory, {translations: {translations: [{id: 'untranslated', source: 'Original opening', translation: ''}, {id: 'translated', source: 'Original next line', translation: previewText}]}});
const previewSegment = previewMaps.models.find(model => model.id === 'main').segments.find(segment => segment.sceneIds.includes('b'));
assert.equal(previewSegment.label, main.segments.find(segment => segment.sceneIds.includes('b')).label, 'numeric/raw labels stay stable');
assert(previewSegment.displayLabel.startsWith('译文预览 '), 'find a later translated line when the first dialogue is untranslated');
assert.equal([...previewSegment.displayLabel].length, 32);
assert(previewSegment.displayLabel.endsWith('…'));

// A cyclic branch cluster is condensed before assigning tiers/depths.
const branchedCycle = structuredClone(synthetic);
branchedCycle.program.nodes.p.exit = {type: 'choices', items: [{label: '循环', then: {type: 'goto', target: 'q'}}, {label: '离开', then: {type: 'goto', target: 'd'}}]};
const cyclic = buildChapterMaps(branchedCycle).models.find(model => model.id === 'loop');
assert(cyclic.segments.every(segment => segment.cycle && Number.isFinite(segment.depth) && Number.isFinite(segment.tier)));
assert.equal(cyclic.edges.filter(edge => edge.from === 'p').length, 2);

// Subroutine returns stay associated with their actual caller instead of every chapter.
const calls = {id: 'calls', startScene: 'call', scenes: [scene('call', 'caller'), scene('after', 'caller'), scene('routine', 'routine')], program: {nodes: {
  call: {sceneId: 'call', exit: {type: 'call', target: 'routine', returnTo: 'after'}},
  after: {sceneId: 'after', exit: {type: 'end'}},
  routine: {sceneId: 'routine', exit: {type: 'return'}},
}}};
const callMaps = buildChapterMaps(calls);
assert.equal(callMaps.models.flatMap(model => model.edges).find(edge => edge.kind === 'return').to, 'after');
assert.equal(callMaps.models.flatMap(model => model.edges).find(edge => edge.kind === 'call').to, 'routine');

console.log(JSON.stringify({passed: true, chapters: 55, referencePages: 13, sceneIdsPreserved: 1442, outgoingEdgesPreserved: allEdges.length, summarySegments: manifest.totals.segments, compressedContinuations, maxChapterScenes: maxScenes, maxChapterSegments: maxSegments, manifestBytes, maxChapterBytes, syntheticCases: ['fork-and-terminal', 'cross-chapter-entrance', 'linear-cycle', 'branch-cycle', 'subroutine-return']}, null, 2));
