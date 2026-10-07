import { browser } from "$app/environment";
import { derived, get, writable } from "svelte/store";

export type TrackStatus = "草稿" | "审校中" | "已通过" | "需修改";
export type CueStatus = "待译" | "翻译中" | "待审" | "已通过" | "退回" | "需修改";
export type TermStatus = "建议" | "已锁定";
export type ChangeType = "译文" | "时间码" | "拆分";
export type ChangeOrigin = "本地" | "协作";

export interface Track {
  id: string;
  name: string;
  locale: "zh" | "en" | "ja";
  status: TrackStatus;
}

export interface Cue {
  id: string;
  trackId: string;
  start: number;
  end: number;
  source: string;
  translated: string;
  status: CueStatus;
  translator: string;
  reviewerNote: string;
}

export interface GlossaryTerm {
  id: string;
  source: string;
  target: string;
  status: TermStatus;
  owner: string;
}

export interface ReviewEvent {
  id: string;
  cueId: string;
  action: "提交审校" | "审校通过" | "退回修改" | "术语锁定" | "术语变更" | "版本冲突" | "版本定夺";
  detail: string;
  actor: string;
  time: string;
}

export interface Snapshot {
  id: string;
  name: string;
  time: string;
  cues: Cue[];
}

export interface TimelineConflict {
  id: string;
  cueId: string;
  message: string;
  remoteStart: number;
  remoteEnd: number;
  status: "待处理" | "采用本地" | "采用协作版本";
}

/** 断网期间积压的本地改动，恢复网络后合并 */
export interface PendingChange {
  id: string;
  cueId: string;
  type: ChangeType;
  payload: { translated?: string; source?: string; start?: number; end?: number };
  actor: string;
  time: string;
}

/** 两人各改一版时，同一条字幕保留的多个译文版本，等审校定夺 */
export interface CueVersion {
  id: string;
  cueId: string;
  actor: string;
  origin: ChangeOrigin;
  translated: string;
  start: number;
  end: number;
  time: string;
  status: "待定夺" | "已采用" | "已弃用";
}

/** 术语变更导致审校失效时，留档的原译文与审校记录 */
export interface ArchiveRecord {
  id: string;
  cueId: string;
  translated: string;
  status: CueStatus;
  reason: string;
  time: string;
  events: ReviewEvent[];
}

const KEY = "pair-wise-yf-51/subtitles-v2";
const seedTracks: Track[] = [
  { id: "zh", name: "中文原字幕", locale: "zh", status: "已通过" },
  { id: "en", name: "English 翻译", locale: "en", status: "审校中" },
  { id: "ja", name: "日本語訳", locale: "ja", status: "草稿" }
];
const seedCues: Cue[] = [
  { id: "c1", trackId: "zh", start: 0, end: 2.8, source: "潮汐退去后，码头重新露出水面。", translated: "潮汐退去后，码头重新露出水面。", status: "已通过", translator: "系统", reviewerNote: "" },
  { id: "c2", trackId: "en", start: 0, end: 2.8, source: "潮汐退去后，码头重新露出水面。", translated: "As the tide recedes, the pier emerges again.", status: "待审", translator: "林岚", reviewerNote: "" },
  { id: "c3", trackId: "en", start: 3.2, end: 6.5, source: "修复组必须在下一场潮水到来前完成加固。", translated: "The repair team must reinforce it before the next tide.", status: "翻译中", translator: "林岚", reviewerNote: "" },
  { id: "c4", trackId: "ja", start: 0, end: 2.8, source: "潮汐退去后，码头重新露出水面。", translated: "潮が引くと、桟橋が再び姿を現す。", status: "待译", translator: "周野", reviewerNote: "" }
];
const seedTerms: GlossaryTerm[] = [
  { id: "g1", source: "潮汐", target: "tide", status: "已锁定", owner: "术语管理员" },
  { id: "g2", source: "码头", target: "pier", status: "已锁定", owner: "术语管理员" },
  { id: "g3", source: "加固", target: "reinforce", status: "建议", owner: "林岚" }
];
const initial = browser && localStorage.getItem(KEY) ? JSON.parse(localStorage.getItem(KEY)!) : null;
export const tracks = writable<Track[]>(initial?.tracks ?? seedTracks);
export const cues = writable<Cue[]>(initial?.cues ?? seedCues);
export const terms = writable<GlossaryTerm[]>(initial?.terms ?? seedTerms);
export const reviewEvents = writable<ReviewEvent[]>(initial?.events ?? []);
export const snapshots = writable<Snapshot[]>(initial?.snapshots ?? []);
export const conflicts = writable<TimelineConflict[]>(initial?.conflicts ?? [{ id: "x1", cueId: "c2", message: "协作者将结束时间调整为3.0秒，与本机存在0.2秒差异。", remoteStart: 0, remoteEnd: 3, status: "待处理" }]);
export const activeTrackId = writable("en");
export const selectedCueId = writable("c2");
export const reviewer = writable("审校-顾宁");

/** 网络状态：断网时改动进积压队列，恢复后自动合并 */
export const online = writable(browser ? navigator.onLine : true);
export const pendingChanges = writable<PendingChange[]>(initial?.pendingChanges ?? []);
export const remoteChanges = writable<PendingChange[]>(initial?.remoteChanges ?? []);
export const cueVersions = writable<CueVersion[]>(initial?.cueVersions ?? []);
export const archives = writable<ArchiveRecord[]>(initial?.archives ?? []);
/** 译文违反术语锁定时的提示（不允许覆盖锁定术语） */
export const termError = writable("");

function persist() {
  if (!browser) return;
  localStorage.setItem(KEY, JSON.stringify({
    tracks: get(tracks), cues: get(cues), terms: get(terms), events: get(reviewEvents),
    snapshots: get(snapshots), conflicts: get(conflicts),
    pendingChanges: get(pendingChanges), remoteChanges: get(remoteChanges),
    cueVersions: get(cueVersions), archives: get(archives)
  }));
}
[tracks, cues, terms, reviewEvents, snapshots, conflicts, pendingChanges, remoteChanges, cueVersions, archives].forEach((store) => store.subscribe(persist));

function uuid() {
  return crypto.randomUUID();
}

function event(cue: Cue | undefined, action: ReviewEvent["action"], detail: string) {
  reviewEvents.update((items) => [{ id: uuid(), cueId: cue?.id ?? "", action, detail, actor: get(reviewer), time: new Date().toISOString() }, ...items]);
}

function fmtTime(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  const tenths = Math.floor((value % 1) * 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

/** 同一处改动重复积压只算一次：同一条字幕同一类型的改动以最新为准 */
function queueLocalChange(cueId: string, type: ChangeType, payload: PendingChange["payload"]) {
  pendingChanges.update((items) => {
    const others = items.filter((item) => !(item.cueId === cueId && item.type === type));
    return [...others, { id: uuid(), cueId, type, payload, actor: get(reviewer), time: new Date().toISOString() }];
  });
}

export function updateCue(id: string, patch: Partial<Cue>, log = false) {
  const before = get(cues).find((cue) => cue.id === id);
  cues.update((items) => items.map((cue) => cue.id === id ? { ...cue, ...patch } : cue));
  if (log) event(get(cues).find((cue) => cue.id === id), "退回修改", "编辑字幕内容或时间码");
  // 断网时译文与时间码改动先积压，联网后合并
  if (get(online) === false && before) {
    if (patch.translated !== undefined || patch.source !== undefined) {
      queueLocalChange(id, "译文", { translated: patch.translated ?? before.translated, source: patch.source ?? before.source });
    }
    if (patch.start !== undefined || patch.end !== undefined) {
      queueLocalChange(id, "时间码", { start: patch.start ?? before.start, end: patch.end ?? before.end });
    }
  }
}

export function nudgeCue(id: string, delta: number) {
  const cue = get(cues).find((item) => item.id === id);
  if (!cue) return;
  updateCue(id, { start: Math.max(0, Number((cue.start + delta).toFixed(1))), end: Math.max(cue.start + 0.5, Number((cue.end + delta).toFixed(1))) });
}

export function splitCue(id: string) {
  const list = get(cues);
  const cue = list.find((item) => item.id === id);
  if (!cue || cue.end - cue.start < 1) return;
  const middle = Number(((cue.start + cue.end) / 2).toFixed(1));
  const first = { ...cue, end: middle, translated: `${cue.translated}`, status: "翻译中" as CueStatus };
  const second = { ...cue, id: uuid(), start: middle, translated: "", status: "待译" as CueStatus };
  cues.set(list.flatMap((item) => item.id === id ? [first, second] : [item]));
  selectedCueId.set(second.id);
  if (get(online) === false) queueLocalChange(id, "拆分", { start: middle, end: cue.end });
}

export function mergeNext(id: string) {
  const list = [...get(cues)].sort((a, b) => a.start - b.start).filter((item) => item.trackId === get(activeTrackId));
  const index = list.findIndex((item) => item.id === id);
  const current = list[index];
  const next = list[index + 1];
  if (!current || !next) return;
  cues.update((items) => items.filter((item) => item.id !== next.id).map((item) => item.id === id ? { ...item, end: next.end, translated: `${item.translated} ${next.translated}`.trim(), status: "翻译中" } : item));
}

export function setCueStatus(id: string, status: CueStatus) {
  updateCue(id, { status });
  const cue = get(cues).find((item) => item.id === id);
  event(cue, status === "待审" ? "提交审校" : status === "已通过" ? "审校通过" : "退回修改", cue?.translated ?? "");
}

/** 提交审校：同一条字幕重复上报只算一次，已在审校队列则不再重复记录 */
export function submitForReview(id: string) {
  const cue = get(cues).find((item) => item.id === id);
  if (!cue || cue.status === "待审") return;
  updateCue(id, { status: "待审" });
  event(cue, "提交审校", cue.translated);
}

export function reviewCue(id: string, approved: boolean, note = "") {
  const cue = get(cues).find((item) => item.id === id);
  if (!cue) return;
  updateCue(id, { status: approved ? "已通过" : "退回", reviewerNote: note });
  event(cue, approved ? "审校通过" : "退回修改", note || cue.translated);
}

/** 检查译文是否覆盖了锁定术语：原文含锁定术语时，译文必须包含锁定的目标词。
 *  术语库为中文→英文，目标词仅在英文轨道强制保护，日文等其他轨道不校验英文目标词。 */
export function lockedTermsViolation(cue: Cue | undefined, translated: string): GlossaryTerm[] {
  if (!cue) return [];
  const track = get(tracks).find((item) => item.id === cue.trackId);
  if (track?.locale !== "en") return [];
  return get(terms).filter((term) => term.status === "已锁定" && cue.source.includes(term.source) && !translated.includes(term.target));
}

/** 编辑译文：锁定术语不许被普通译文盖掉，违规内容不写入时间轴 */
export function editTranslation(id: string, translated: string): boolean {
  const cue = get(cues).find((item) => item.id === id);
  if (!cue) return false;
  const missing = lockedTermsViolation(cue, translated);
  if (missing.length) {
    termError.set(`译文缺少锁定术语：${missing.map((term) => `${term.source}→${term.target}`).join("、")}。锁定术语不可被普通译文覆盖。`);
    return false;
  }
  termError.set("");
  updateCue(id, { translated });
  return true;
}

/** 留档：保存字幕原译文与相关审校记录，供术语变更后追溯 */
export function archiveCue(cue: Cue, reason: string) {
  const related = get(reviewEvents).filter((item) => item.cueId === cue.id);
  archives.update((items) => [{
    id: uuid(), cueId: cue.id, translated: cue.translated, status: cue.status, reason,
    time: new Date().toISOString(), events: structuredClone(related)
  }, ...items]);
}

/** 术语锁定：英文轨道上已通过的译文若未使用锁定术语，审校结论失效，留档后需重新确认 */
export function lockTerm(id: string) {
  const term = get(terms).find((item) => item.id === id);
  if (!term || term.status === "已锁定") return;
  terms.update((items) => items.map((item) => item.id === id ? { ...item, status: "已锁定", owner: "术语管理员" } : item));
  const affected = get(cues).filter((cue) => {
    const track = get(tracks).find((item) => item.id === cue.trackId);
    return cue.status === "已通过" && track?.locale === "en" && cue.source.includes(term.source) && !cue.translated.includes(term.target);
  });
  affected.forEach((cue) => {
    archiveCue(cue, `术语「${term.source}」锁定为「${term.target}」`);
    updateCue(cue.id, { status: "需修改", reviewerNote: `术语已锁定为「${term.target}」，请重新确认译文` });
    event(cue, "术语锁定", `锁定后复查：译文未包含「${term.target}」，原审校结论失效，原译文与审校记录已留档`);
  });
  event(undefined, "术语锁定", `${term.source} → ${term.target}${affected.length ? `，${affected.length} 条已通过字幕需重新确认` : ""}`);
}

/** 术语译文变更：英文轨道上引用该术语的已通过字幕结论失效，必须重新确认，原译文与审校记录留档 */
export function updateTermTarget(id: string, target: string) {
  const term = get(terms).find((item) => item.id === id);
  const next = target.trim();
  if (!term || !next || term.target === next) return;
  const affected = get(cues).filter((cue) => {
    const track = get(tracks).find((item) => item.id === cue.trackId);
    return cue.status === "已通过" && track?.locale === "en" && cue.source.includes(term.source);
  });
  affected.forEach((cue) => {
    archiveCue(cue, `术语「${term.source}」译文变更：${term.target} → ${next}`);
    updateCue(cue.id, { status: "需修改", reviewerNote: `术语已变更为「${next}」，请重新确认译文` });
    event(cue, "术语变更", `术语「${term.source}」变更为「${next}」，原审校结论失效，原译文与审校记录已留档，待重新确认`);
  });
  terms.update((items) => items.map((item) => item.id === id ? { ...item, target: next } : item));
  event(undefined, "术语变更", `术语「${term.source}」译文由「${term.target}」改为「${next}」，${affected.length} 条已通过字幕需重新确认`);
}

/** 审校定夺：从两人各留的版本中采用一版，被弃用的原译文留档 */
export function adoptVersion(versionId: string) {
  const version = get(cueVersions).find((item) => item.id === versionId);
  if (!version) return;
  const cue = get(cues).find((item) => item.id === version.cueId);
  if (!cue) return;
  if (cue.translated !== version.translated) archiveCue(cue, `版本定夺：采用${version.origin}版本（${version.actor}），弃用原译文`);
  updateCue(version.cueId, { translated: version.translated, start: version.start, end: version.end, status: "待审", reviewerNote: "" });
  cueVersions.update((items) => items.map((item) => item.cueId === version.cueId ? { ...item, status: item.id === versionId ? "已采用" : "已弃用" } : item));
  event(cue, "版本定夺", `审校采用${version.origin}版本（${version.actor}）：${version.translated}`);
}

/** 模拟协作者在断网期间提交的译文改动 */
export const remoteVariants: Record<string, string> = {
  c2: "As the tide goes out, the pier emerges once more.",
  c3: "The repair crew must finish reinforcement before the next high tide.",
  c4: "潮が退くと、桟橋が再び現れる。",
  c1: "潮が引いて、桟橋が再び姿を現した。"
};

export function injectRemoteChange(cueId: string, translated: string, actor = "协作-林岚") {
  const cue = get(cues).find((item) => item.id === cueId);
  if (!cue) return;
  const next = translated.trim();
  if (!next || next === cue.translated) return;
  remoteChanges.update((items) => [
    ...items.filter((item) => !(item.cueId === cueId && item.type === "译文")),
    { id: uuid(), cueId, type: "译文", payload: { translated: next }, actor, time: new Date().toISOString() }
  ]);
}

/** 模拟协作者在断网期间拆分了同一条字幕 */
export function injectRemoteSplit(cueId: string, actor = "协作-林岚") {
  const cue = get(cues).find((item) => item.id === cueId);
  if (!cue || cue.end - cue.start < 1) return;
  const middle = Number(((cue.start + cue.end) / 2).toFixed(1));
  remoteChanges.update((items) => [
    ...items.filter((item) => !(item.cueId === cueId && item.type === "拆分")),
    { id: uuid(), cueId, type: "拆分", payload: { start: middle, end: cue.end }, actor, time: new Date().toISOString() }
  ]);
}

export function removePendingChange(id: string) {
  pendingChanges.update((items) => items.filter((item) => item.id !== id));
}

export function removeRemoteChange(id: string) {
  remoteChanges.update((items) => items.filter((item) => item.id !== id));
}

function dedupeChanges(changes: PendingChange[]): PendingChange[] {
  const map = new Map<ChangeType, PendingChange>();
  changes.forEach((change) => {
    const prev = map.get(change.type);
    if (!prev || change.time > prev.time) map.set(change.type, change);
  });
  return [...map.values()];
}

/** 网络恢复：把本地积压改动与协作者改动合并到同一条时间轴。
 *  两人改过同一条字幕 → 各留一版等审校定夺；重复改动只算一次；
 *  违反锁定术语的协作译文会被术语保护拦截。 */
export function mergePending() {
  const local = get(pendingChanges);
  const remote = get(remoteChanges);
  if (!local.length && !remote.length) return;
  const cueIds = new Set([...local.map((item) => item.cueId), ...remote.map((item) => item.cueId)]);
  const newVersions: CueVersion[] = [];
  let applied = 0;
  let blocked = 0;
  cueIds.forEach((cueId) => {
    const cue = get(cues).find((item) => item.id === cueId);
    if (!cue) return;
    const l = dedupeChanges(local.filter((item) => item.cueId === cueId));
    const r = dedupeChanges(remote.filter((item) => item.cueId === cueId));
    const localText = l.find((item) => item.type === "译文");
    const remoteText = r.find((item) => item.type === "译文");
    if (localText && remoteText) {
      const missing = lockedTermsViolation(cue, remoteText.payload.translated ?? "");
      if (missing.length) {
        blocked += 1;
        event(cue, "版本冲突", `术语保护：协作版本缺少锁定术语 ${missing.map((term) => term.target).join("、")}，已阻止覆盖，保留本地译文`);
      } else {
        newVersions.push(
          { id: uuid(), cueId, actor: "本地离线修改", origin: "本地", translated: cue.translated, start: cue.start, end: cue.end, time: localText.time, status: "待定夺" },
          { id: uuid(), cueId, actor: remoteText.actor, origin: "协作", translated: remoteText.payload.translated ?? cue.translated, start: cue.start, end: cue.end, time: remoteText.time, status: "待定夺" }
        );
        updateCue(cueId, { status: "待审" });
        event(cue, "版本冲突", "两人各改一版，已保留双方译文等待审校定夺");
      }
    } else if (remoteText) {
      const next = remoteText.payload.translated ?? cue.translated;
      const missing = lockedTermsViolation(cue, next);
      if (missing.length) {
        blocked += 1;
        event(cue, "版本冲突", `术语保护：协作译文缺少锁定术语 ${missing.map((term) => term.target).join("、")}，已阻止覆盖`);
      } else {
        updateCue(cueId, { translated: next, source: remoteText.payload.source ?? cue.source });
        applied += 1;
      }
    }
    const localTime = l.find((item) => item.type === "时间码");
    const remoteTime = r.find((item) => item.type === "时间码");
    if (localTime && remoteTime) {
      conflicts.update((items) => [...items, {
        id: uuid(), cueId,
        message: `协作者把时间码调整为 ${fmtTime(remoteTime.payload.start ?? 0)}–${fmtTime(remoteTime.payload.end ?? 0)}，与本机离线修改存在差异。`,
        remoteStart: remoteTime.payload.start ?? cue.start, remoteEnd: remoteTime.payload.end ?? cue.end, status: "待处理"
      }]);
    } else if (remoteTime) {
      updateCue(cueId, { start: remoteTime.payload.start ?? cue.start, end: remoteTime.payload.end ?? cue.end });
      applied += 1;
    }
    const localSplit = l.find((item) => item.type === "拆分");
    const remoteSplit = r.find((item) => item.type === "拆分");
    if (localSplit && remoteSplit) {
      event(cue, "版本冲突", "双方离线时都拆分了同一条字幕，已保留本地拆分；如需恢复请使用版本快照");
    } else if (remoteSplit) {
      const payload = remoteSplit.payload;
      const middle = payload.start ?? (cue.start + cue.end) / 2;
      cues.update((items) => {
        if (items.some((item) => item.trackId === cue.trackId && Math.abs(item.start - middle) < 0.05)) return items;
        const head = items.map((item) => item.id === cueId ? { ...item, end: middle } : item);
        return [...head, { id: uuid(), trackId: cue.trackId, start: middle, end: payload.end ?? cue.end, source: cue.source, translated: "", status: "待译" as CueStatus, translator: remoteSplit.actor, reviewerNote: "" }];
      });
      event(cue, "版本冲突", `已合并协作者的离线拆分（${remoteSplit.actor}）`);
      applied += 1;
    }
  });
  if (newVersions.length) cueVersions.update((items) => [...items, ...newVersions]);
  pendingChanges.set([]);
  remoteChanges.set([]);
  event(undefined, "版本冲突", `离线改动已合并：${applied} 条协作改动已应用，${newVersions.length / 2} 条字幕存在多版译文待审校定夺${blocked ? `，${blocked} 条违规译文被术语保护拦截` : ""}`);
}

/** 切换网络；恢复在线时自动把积压改动合并到时间轴 */
export function setOnline(value: boolean) {
  const wasOffline = get(online) === false;
  online.set(value);
  if (value && wasOffline && (get(pendingChanges).length || get(remoteChanges).length)) mergePending();
}

export function createSnapshot(name = `时间轴快照 ${get(snapshots).length + 1}`) {
  snapshots.update((items) => [{ id: uuid(), name, time: new Date().toISOString(), cues: structuredClone(get(cues)) }, ...items].slice(0, 12));
}

export function restoreSnapshot(id: string) {
  const snapshot = get(snapshots).find((item) => item.id === id);
  if (snapshot) cues.set(structuredClone(snapshot.cues));
}

export function resolveConflict(id: string, resolution: TimelineConflict["status"]) {
  conflicts.update((items) => items.map((item) => item.id === id ? { ...item, status: resolution } : item));
  if (resolution === "采用协作版本") {
    const conflict = get(conflicts).find((item) => item.id === id);
    if (conflict) updateCue(conflict.cueId, { start: conflict.remoteStart, end: conflict.remoteEnd });
  }
}

export const activeCues = derived(
  [cues, activeTrackId, selectedCueId, cueVersions, pendingChanges],
  ([$cues, $activeTrackId, $selectedCueId, $cueVersions, $pendingChanges]) =>
    $cues
      .filter((cue) => cue.trackId === $activeTrackId)
      .sort((a, b) => a.start - b.start)
      .map((cue) => ({
        ...cue,
        selected: cue.id === $selectedCueId,
        pending: $pendingChanges.some((item) => item.cueId === cue.id),
        versionCount: $cueVersions.filter((item) => item.cueId === cue.id && item.status === "待定夺").length
      }))
);

export const pendingVersionCount = derived(cueVersions, ($cueVersions) => $cueVersions.filter((item) => item.status === "待定夺").length);
