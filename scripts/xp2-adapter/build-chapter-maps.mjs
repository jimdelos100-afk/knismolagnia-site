import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {graphStory} from '../../private/story-player/src/playback.js';

const SCHEMA_VERSION = 1;
const isReference = scene => scene.category === 'reference' || /^(archive-|reference-)/.test(scene.id);
const rowOf = scene => Number(scene.id.match(/-row-(\d+)$/)?.[1]) || null;
const stripRow = scene => String(scene.title || scene.id).replace(/\s*·\s*\d+$/, '');
const shortPreview = value => { const characters = [...String(value || '')]; return characters.length > 32 ? `${characters.slice(0, 31).join('')}…` : characters.join(''); };
const plainText = value => String(value || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

export function chapterPresentation(scene) {
  const sourceTitle = stripRow(scene);
  if (isReference(scene)) return {title: scene.chapter || scene.title, sourceTitle, section: 'reference'};
  if (/^Scene_(GameOver|CA-|CO-)/i.test(sourceTitle)) return {title: `结束分支 ${scene.id.match(/^chapter-(\d+)/)?.[1] || ''}`.trim(), sourceTitle, section: 'ending'};
  if (/^omake[_-]?(\d*)/i.test(sourceTitle)) return {title: `追加剧情 ${sourceTitle.match(/^omake[_-]?(\d*)/i)[1]}`.trim(), sourceTitle, section: 'extra'};
  if (/^Start$/i.test(sourceTitle)) return {title: '故事开始', sourceTitle, section: 'main'};
  if (/^0_11thPR$/i.test(sourceTitle)) return {title: '开场演出', sourceTitle, section: 'main'};
  const numbered = sourceTitle.match(/^(\d+)([AB])?_(?:(\d+)_)?(.+)$/i);
  if (numbered) {
    const [, chapter, branch, part, suffix] = numbered;
    const kind = /CG/i.test(suffix) ? 'CG 演出' : /Tutorial/i.test(suffix) ? '引导剧情' : /^vs/i.test(suffix) ? '讨论剧情' : /breaktxt/i.test(suffix) ? '幕间剧情' : /txt$/i.test(suffix) ? '剧情' : suffix;
    const phase = /^vs/i.test(suffix) ? suffix.match(/_(\d+)$/)?.[1] : null;
    return {title: [`第 ${chapter} 章`, branch ? `分支 ${branch.toUpperCase()}` : '', part ? `片段 ${part}` : '', kind, phase ? `阶段 ${phase}` : ''].filter(Boolean).join(' · '), sourceTitle, section: 'main'};
  }
  return {title: scene.chapter || scene.title, sourceTitle, section: 'main'};
}

function hasTerminal(exit) {
  if (!exit) return false;
  if (exit.type === 'end') return true;
  if (exit.type === 'set') return hasTerminal(exit.then);
  if (exit.type === 'if') return exit.branches.some(branch => hasTerminal(branch.then)) || hasTerminal(exit.else);
  if (exit.type === 'choices') return exit.items.some(item => hasTerminal(item.then));
  if (exit.type === 'signal') return exit.outcomes.some(item => hasTerminal(item.then));
  return false;
}

/** Tarjan's SCCs keep the chapter hierarchy finite even when a route loops. */
export function stronglyConnected(ids, edges) {
  const adjacency = new Map(ids.map(id => [id, []]));
  for (const edge of edges) if (!edge.terminal && adjacency.has(edge.from) && adjacency.has(edge.to)) adjacency.get(edge.from).push(edge.to);
  let next = 0;
  const indices = new Map(), low = new Map(), stack = [], active = new Set(), components = [];
  function visit(id) {
    indices.set(id, next); low.set(id, next++); stack.push(id); active.add(id);
    for (const to of adjacency.get(id)) {
      if (!indices.has(to)) { visit(to); low.set(id, Math.min(low.get(id), low.get(to))); }
      else if (active.has(to)) low.set(id, Math.min(low.get(id), indices.get(to)));
    }
    if (low.get(id) !== indices.get(id)) return;
    const component = [];
    let value;
    do { value = stack.pop(); active.delete(value); component.push(value); } while (value !== id);
    components.push(component);
  }
  for (const id of ids) if (!indices.has(id)) visit(id);
  return components;
}

function assignHierarchy(segments, edges) {
  const local = edges.filter(edge => !edge.crossChapter && !edge.terminal);
  const segmentEdges = local.map(edge => ({from: edge.fromSegment, to: edge.toSegment}));
  const components = stronglyConnected(segments.map(segment => segment.id), segmentEdges);
  const componentOf = new Map();
  components.forEach((ids, index) => ids.forEach(id => componentOf.set(id, index)));
  const next = components.map(() => new Set()), previous = components.map(() => new Set());
  for (const edge of segmentEdges) {
    const from = componentOf.get(edge.from), to = componentOf.get(edge.to);
    if (from !== to) { next[from].add(to); previous[to].add(from); }
  }
  const segmentById = new Map(segments.map(segment => [segment.id, segment]));
  const branch = components.map(ids => ids.some(id => segmentById.get(id).branch));
  const sourceOrder = components.map(ids => Math.min(...ids.map(id => segmentById.get(id).order)));
  const degree = previous.map(set => set.size), queue = degree.map((value, index) => value === 0 ? index : -1).filter(index => index >= 0);
  const tiers = components.map(() => 0), depths = components.map(() => 0);
  while (queue.length) {
    queue.sort((a, b) => sourceOrder[a] - sourceOrder[b]);
    const from = queue.shift();
    for (const to of next[from]) {
      tiers[to] = Math.max(tiers[to], tiers[from] + 1);
      depths[to] = Math.max(depths[to], depths[from] + Number(branch[from]));
      if (--degree[to] === 0) queue.push(to);
    }
  }
  for (const segment of segments) {
    const component = componentOf.get(segment.id);
    segment.tier = tiers[component];
    segment.depth = depths[component];
    segment.cycle = components[component].length > 1 || local.some(edge => edge.fromSegment === segment.id && edge.toSegment === segment.id && !edge.internal);
    segment.component = component;
  }
}

/** Collapse only unlabelled, unambiguous linear continuations; every raw scene remains addressable. */
export function summarizeChapter({id, title, sourceTitle, section, category, scenes, edges, sceneToChapter, incoming, terminalScenes, previews = new Map(), translatedPreviews = new Map()}) {
  const ids = new Set(scenes.map(scene => scene.id));
  const outgoing = new Map(scenes.map(scene => [scene.id, []]));
  for (const edge of edges) outgoing.get(edge.from)?.push(edge);
  const canContinue = new Map();
  for (const scene of scenes) {
    const routes = outgoing.get(scene.id);
    if (routes.length !== 1) continue;
    const edge = routes[0];
    if (edge.terminal || edge.label || edge.kind !== 'next' || edge.condition || !ids.has(edge.to) || incoming.get(edge.to)?.length !== 1) continue;
    canContinue.set(scene.id, edge.to);
  }
  const predecessor = new Map([...canContinue].map(([from, to]) => [to, from]));
  const segments = [], segmentOf = new Map();
  const index = new Map(scenes.map((scene, order) => [scene.id, order]));
  const sceneById = new Map(scenes.map(scene => [scene.id, scene]));
  const starts = [...scenes.filter(scene => !predecessor.has(scene.id)), ...scenes];
  for (const start of starts) {
    if (segmentOf.has(start.id)) continue;
    const segment = {id: `${id}:segment-${segments.length + 1}`, label: '', sceneIds: [], entrySceneId: start.id, order: index.get(start.id), tier: 0, depth: 0, cycle: false, branch: false, terminal: false, outgoing: []};
    let current = start.id;
    while (current && !segmentOf.has(current)) {
      segment.sceneIds.push(current); segmentOf.set(current, segment.id);
      current = canContinue.get(current);
    }
    const first = sceneById.get(segment.sceneIds[0]), last = sceneById.get(segment.sceneIds.at(-1));
    const firstRow = rowOf(first), lastRow = rowOf(last);
    segment.label = category === 'reference' ? first.title : firstRow === lastRow ? `脚本行 ${firstRow}` : `脚本行 ${firstRow}–${lastRow}`;
    segment.branch = segment.sceneIds.some(sceneId => (outgoing.get(sceneId)?.length || 0) > 1 || outgoing.get(sceneId)?.some(edge => ['choice', 'condition', 'signal'].includes(edge.kind)));
    segment.terminal = segment.sceneIds.some(sceneId => terminalScenes.has(sceneId));
    segments.push(segment);
  }
  const segmentById = new Map(segments.map(segment => [segment.id, segment]));
  const modelEdges = edges.map(edge => {
    const fromSegment = segmentOf.get(edge.from), toSegment = segmentOf.get(edge.to);
    const sequence = segmentById.get(fromSegment).sceneIds;
    const fromPosition = sequence.indexOf(edge.from);
    const internal = !edge.terminal && fromSegment === toSegment && sequence[fromPosition + 1] === edge.to;
    return {...edge, fromSegment, ...(toSegment ? {toSegment} : {}), toChapterId: sceneToChapter[edge.to], crossChapter: sceneToChapter[edge.to] !== id, ...(internal ? {internal: true} : {})};
  });
  for (const edge of modelEdges) if (!edge.internal) segmentById.get(edge.fromSegment).outgoing.push(edge.id);
  assignHierarchy(segments, modelEdges);
  for (const segment of segments) {
    const preview = segment.sceneIds.map(sceneId => translatedPreviews.get(sceneId)).find(Boolean);
    segment.displayLabel = shortPreview(preview || (segment.branch ? '分支选择' : segment.cycle ? '回环剧情' : (incoming.get(segment.entrySceneId)?.length || 0) > 1 ? '剧情合流' : segment.terminal || !segment.outgoing.length ? '章节结束' : '剧情段落'));
  }
  const metadata = scenes.map(scene => {
    const routes = outgoing.get(scene.id), row = rowOf(scene);
    const preview = previews.get(scene.id);
    return {id: scene.id, title: scene.title, label: `${row ? `脚本行 ${row}` : scene.title}${preview ? ` · ${preview}` : ''}`, ...(row ? {row} : {}), kind: routes.length > 1 || routes.some(edge => ['choice', 'condition', 'signal'].includes(edge.kind)) ? 'branch' : category === 'reference' ? 'reference' : terminalScenes.has(scene.id) ? 'end' : 'scene', segmentId: segmentOf.get(scene.id), terminal: terminalScenes.has(scene.id)};
  });
  segments.sort((a, b) => a.tier - b.tier || a.order - b.order);
  return {schemaVersion: SCHEMA_VERSION, id, title, sourceTitle, section, category, entrySceneId: scenes[0].id, scenes: metadata, segments, edges: modelEdges};
}

/** Offline build: the browser requests this small index plus exactly one chapter, never a global graph. */
export function buildChapterMaps(story, {referenceGroupSize = 24, translations = null} = {}) {
  if (!Number.isInteger(referenceGroupSize) || referenceGroupSize < 1) throw new Error('referenceGroupSize must be a positive integer.');
  const graph = graphStory(story), sceneToChapter = {}, groups = new Map(), referenceGroups = new Map();
  for (const scene of graph.scenes) {
    const destination = isReference(scene) ? referenceGroups : groups;
    const groupId = scene.mapGroup || scene.id;
    if (!destination.has(groupId)) destination.set(groupId, []);
    destination.get(groupId).push(scene);
  }
  const chapterGroups = [...groups].map(([id, scenes]) => ({id, ...chapterPresentation(scenes[0]), category: 'story', scenes}));
  const references = [...referenceGroups.values()];
  for (let offset = 0; offset < references.length; offset += referenceGroupSize) {
    const page = references.slice(offset, offset + referenceGroupSize), number = offset / referenceGroupSize + 1;
    chapterGroups.push({id: `reference-page-${String(number).padStart(2, '0')}`, title: `译文资料 ${offset + 1}–${Math.min(offset + referenceGroupSize, references.length)}`, sourceTitle: '讨论与界面译文资料', section: 'reference', category: 'reference', scenes: page.flat()});
  }
  for (const group of chapterGroups) for (const scene of group.scenes) sceneToChapter[scene.id] = group.id;
  const terminalScenes = new Set();
  for (const node of Object.values(story.program?.nodes || {})) if (hasTerminal(node.exit)) terminalScenes.add(node.sceneId);
  if (!story.program) for (const scene of story.scenes) if (!scene.next && !scene.choices?.length) terminalScenes.add(scene.id);
  const graphEdges = graph.graphEdges || graph.scenes.flatMap(scene => [...(scene.next ? [{from: scene.id, to: scene.next, label: '', kind: 'next'}] : []), ...(scene.choices || []).map(choice => ({from: scene.id, to: choice.target, label: choice.label, kind: 'choice'}))]).map((edge, index) => ({id: `route-${index}`, ...edge}));
  const incoming = new Map(graph.scenes.map(scene => [scene.id, []]));
  for (const edge of graphEdges) if (!edge.terminal) incoming.get(edge.to)?.push(edge);
  const translationById = new Map((translations?.translations || []).map(item => [item.id, item.translation || '']));
  const sourceById = new Map((story.texts || []).map(item => [item.id, item.source || '']));
  const previews = new Map(), translatedPreviews = new Map();
  for (const scene of graph.scenes) {
    const dialogues = (scene.events || []).filter(event => event.type === 'dialogue' && event.textId), textId = dialogues[0]?.textId;
    const translated = dialogues.map(event => plainText(translationById.get(event.textId))).find(Boolean);
    const text = plainText(translationById.get(textId) || sourceById.get(textId));
    if (text) previews.set(scene.id, shortPreview(text));
    if (translated) translatedPreviews.set(scene.id, shortPreview(translated));
  }
  const models = chapterGroups.map(group => summarizeChapter({...group, edges: graphEdges.filter(edge => sceneToChapter[edge.from] === group.id), sceneToChapter, incoming, terminalScenes, previews, translatedPreviews}));
  const chapters = chapterGroups.map((group, index) => {
    const model = models[index];
    return {id: group.id, title: group.title, sourceTitle: group.sourceTitle, section: group.section, category: group.category, order: index, file: `${group.id}.json`, entrySceneId: model.entrySceneId, sceneCount: model.scenes.length, segmentCount: model.segments.length, branchCount: model.scenes.filter(scene => scene.kind === 'branch').length};
  });
  return {manifest: {schemaVersion: SCHEMA_VERSION, storyId: story.id, startSceneId: story.startScene, chapters, sceneToChapter, totals: {scenes: graph.scenes.length, chapters: groups.size, referencePages: chapters.length - groups.size, segments: models.reduce((sum, model) => sum + model.segments.length, 0), edges: graphEdges.length, storyScenes: graph.scenes.filter(scene => !isReference(scene)).length, referenceScenes: graph.scenes.filter(isReference).length}}, models};
}

export function writeChapterMaps(storyFile, outputDirectory) {
  const translationFile = path.join(path.dirname(storyFile), 'translations.json');
  const translations = fs.existsSync(translationFile) ? JSON.parse(fs.readFileSync(translationFile, 'utf8')) : null;
  const source = fs.readFileSync(storyFile), {manifest, models} = buildChapterMaps(JSON.parse(source), {translations});
  manifest.storySha256 = crypto.createHash('sha256').update(source).digest('hex');
  fs.mkdirSync(outputDirectory, {recursive: true});
  const json = value => `${JSON.stringify(value)}\n`;
  fs.writeFileSync(path.join(outputDirectory, 'manifest.json'), json(manifest));
  for (const model of models) fs.writeFileSync(path.join(outputDirectory, `${model.id}.json`), json(model));
  return {files: models.length + 1, manifestBytes: Buffer.byteLength(json(manifest)), maxChapterBytes: Math.max(...models.map(model => Buffer.byteLength(json(model)))), maxChapterScenes: Math.max(...models.map(model => model.scenes.length)), ...manifest.totals};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const storyFile = process.argv[2] || path.join(root, 'private/story-player/data/story.json');
  const outputDirectory = process.argv[3] || path.join(root, 'private/story-player/data/chapter-map');
  console.log(JSON.stringify(writeChapterMaps(storyFile, outputDirectory), null, 2));
}
